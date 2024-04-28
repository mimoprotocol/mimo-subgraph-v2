/* eslint-disable prefer-const */
import { Pair, Token, Bundle } from '../types/schema'
import { BigDecimal, Address, BigInt } from '@graphprotocol/graph-ts/index'
import { ZERO_BD, factoryContract, ADDRESS_ZERO, ONE_BD, UNTRACKED_PAIRS } from './helpers'

const WETH_ADDRESS = '0xa00744882684c3e4747faefd68d283ea44099d03'
const USDT_WETH_PAIR = '0x6bdefe87c4b18726002d3505b3251c89c8004c6a'
const BUSD_WETH_PAIR = '0x2a7775e754ca239c54030d7d804c7cb49cb38567'

export function getEthPriceInUSD(): BigDecimal {
  // fetch eth prices for each stablecoin
  let usdtPair = Pair.load(USDT_WETH_PAIR) // usdt is token0
  let busdPair = Pair.load(BUSD_WETH_PAIR) // busd is token1

  if (
    usdtPair !== null &&
    busdPair !== null
  ) {
    let totalLiquidityETH = usdtPair.reserve1.plus(busdPair.reserve0)
    let usdtWeight = usdtPair.reserve1.div(totalLiquidityETH)
    let busdWeight = busdPair.reserve0.div(totalLiquidityETH)
    return usdtPair.token0Price
      .times(usdtWeight)
      .plus(busdPair.token1Price.times(busdWeight))
  } else if (usdtPair !== null) {
    return usdtPair.token0Price
  } else {
    return BigDecimal.fromString('0.05')
  }
}
// token where amounts should contribute to tracked volume and liquidity
let WHITELIST: string[] = [
  '0xa00744882684c3e4747faefd68d283ea44099d03', // WETH
  '0xb8744ae4032be5e5ef9fab94ee9c3bf38d5d2ae0', // VITA
  '0x0258866edaf84d6081df17660357ab20a07d0c80', // ioETH
  '0x4752456e00def6025c77b55a88a2f8a1701f92f9', // METX
  '0xc7b93720f73b037394ce00f954f849ed484a3dea', // ioBTC
  '0x6fbcdc1169b5130c59e72e51ed68a84841c98cd1', // ioUSDT
  '0x42c9255d5e522e83b16ea11a3ba04c2d3afca079', // USDT_b
  '0xacee9b11cd4b3f57e58880277ac72c8c41abe4e4', // ioBUSD
  '0x4d7b88403aa2f502bf289584160db01ca442426c', // CYC
  '0x97e6c48867fdc391a8dfe9d169ecd005d1d90283', // BNB
  '0xedeefaca6a1581fe2349cdfc3083d4efa8188e55', // ioUNI
  '0x84abcb2832be606341a50128aeb1db43aa017449', // BUSD-bsc
  '0x99b2b0efb56e62e36960c20cd5ca8ec6abd5557a', // CIOTX
  '0x17df9fbfc1cdab0f90eddc318c4f6fcada730cf2', // GFT
  '0x490cfbf9b9c43633ddd1968d062996227ef438a9', // iMAGIC
  '0x3cdb7c48e70b854ed2fa392e21687501d84b3afc', // USDT-matic
  '0x62a9d987cbf4c45a550deed5b57b200d7a319632', // DAI-matic
  '0x86702a7f8898b172de396eb304d7d81207127915', // ZOOM
  '0xf87aed04889a1dd0159d9c22b0d57b345ab16ddd', // ZM
  '0x3fe04320885e6124231254c802004871be681218', // MCN
  '0x3b2bf2b523f54c4e454f08aa286d03115aff326c', // USDC
  '0xc04da3a99d17135857bb937d2fbb321d3b6c6a81', // USDC_m
  '0x037346e5a5722957ac2cab6ceb8c74fc18cea91d', // USDC_b
  '0xec690cdd448e3cbb51ed135df72301c3265a8f80', // XIM
  '0x6c0bf4b53696b5434a0d21c7d13aa3cbf754913e', // WEN
]

// minimum liquidity required to count towards tracked volume for pairs with small # of Lps
let MINIMUM_USD_THRESHOLD_NEW_PAIRS = BigDecimal.fromString('0.00001')

// minimum liquidity for price to get tracked
let MINIMUM_LIQUIDITY_THRESHOLD_ETH = BigDecimal.fromString('0.00001')

/**
 * Search through graph to find derived Eth per token.
 * @todo update to be derived ETH (add stablecoin estimates)
 **/
export function findEthPerToken(token: Token): BigDecimal {
  if (token.id == WETH_ADDRESS) {
    return ONE_BD
  }
  // loop through whitelist and check if paired with any
  for (let i = 0; i < WHITELIST.length; ++i) {
    let pairAddress = factoryContract.getPair(Address.fromString(token.id), Address.fromString(WHITELIST[i]))
    if (pairAddress.toHexString() != ADDRESS_ZERO) {
      let pair = Pair.load(pairAddress.toHexString())
      if (pair === null) {
        continue
      }
      if (pair.token0 == token.id && pair.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_ETH)) {
        let token1 = Token.load(pair.token1)
        if (token1 === null) {
          continue
        }
        return pair.token1Price.times(token1.derivedETH as BigDecimal) // return token1 per our token * Eth per token 1
      }
      if (pair.token1 == token.id && pair.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_ETH)) {
        let token0 = Token.load(pair.token0)
        if (token0 === null) {
          continue
        }
        return pair.token0Price.times(token0.derivedETH as BigDecimal) // return token0 per our token * ETH per token 0
      }
    }
  }
  return ZERO_BD // nothing was found return 0
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD.
 * If both are, return average of two amounts
 * If neither is, return 0
 */
export function getTrackedVolumeUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token,
  pair: Pair
): BigDecimal {
  let bundle = Bundle.load('1')!
  let price0 = token0.derivedETH.times(bundle.ethPrice)
  let price1 = token1.derivedETH.times(bundle.ethPrice)

  // dont count tracked volume on these pairs - usually rebass tokens
  if (UNTRACKED_PAIRS.includes(pair.id)) {
    return ZERO_BD
  }

  // if less than 5 LPs, require high minimum reserve amount amount or return 0
  if (pair.liquidityProviderCount.lt(BigInt.fromI32(2))) {
    let reserve0USD = pair.reserve0.times(price0)
    let reserve1USD = pair.reserve1.times(price1)
    if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
      if (reserve0USD.plus(reserve1USD).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
    if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
      if (reserve0USD.times(BigDecimal.fromString('2')).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
    if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
      if (reserve1USD.times(BigDecimal.fromString('2')).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
  }

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0
      .times(price0)
      .plus(tokenAmount1.times(price1))
      .div(BigDecimal.fromString('2'))
  }

  // take full value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0)
  }

  // take full value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1)
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD * 2.
 * If both are, return sum of two amounts
 * If neither is, return 0
 */
export function getTrackedLiquidityUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token
): BigDecimal {
  let bundle = Bundle.load('1')!
  let price0 = token0.derivedETH.times(bundle.ethPrice)
  let price1 = token1.derivedETH.times(bundle.ethPrice)

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).plus(tokenAmount1.times(price1))
  }

  // take double value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).times(BigDecimal.fromString('2'))
  }

  // take double value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1).times(BigDecimal.fromString('2'))
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}
