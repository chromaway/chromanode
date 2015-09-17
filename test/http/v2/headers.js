import _ from 'lodash'
import { expect } from 'chai'
import bitcore from 'bitcore'

import request from '../request'

export default function (opts) {
  let getHeader = async (hash) => {
    if (_.isNumber(hash)) {
      hash = (await opts.bitcoind.rpc.getBlockHash(hash)).result
    }

    let {result} = await opts.bitcoind.rpc.getBlock(hash)
    let header = bitcore.BlockHeader({
      version: result.version,
      prevHash: result.previousblockhash || new Array(65).join('0'),
      merkleRoot: result.merkleroot,
      time: result.time,
      bits: parseInt(result.bits, 16),
      nonce: result.nonce
    })

    return header.toString()
  }

  describe('headers', () => {
    it('latest', async () => {
      let result = await request(opts, '/v2/headers/latest')

      let height = (await opts.bitcoind.rpc.getBlockCount()).result
      let blockHash = (await opts.bitcoind.rpc.getBlockHash(height)).result
      let header = await getHeader(blockHash)

      expect(result).to.deep.equal({
        hash: blockHash,
        header: header,
        height: height
      })
    })

    describe('query', () => {
      it('without arguments', async () => {
        let result = await request(opts, '/v2/headers/query')

        let count = (await opts.bitcoind.rpc.getBlockCount()).result + 1
        let headers = ''
        for (let i = 0; i < count; ++i) {
          headers += await getHeader(i)
        }

        expect(result).to.deep.equal({
          from: -1,
          count: count,
          headers: headers
        })
      })

      it('half-open interval', async () => {
        let expected = {
          from: 2,
          count: 2,
          headers: (await getHeader(3)) + (await getHeader(4))
        }

        let hash2 = (await opts.bitcoind.rpc.getBlockHash(2)).result
        let hash4 = (await opts.bitcoind.rpc.getBlockHash(4)).result

        let result1 = await request(opts, `/v2/headers/query?from=${hash2}&to=4`)
        expect(result1).to.deep.equal(expected)
        let result2 = await request(opts, `/v2/headers/query?from=2&to=${hash4}`)
        expect(result2).to.deep.equal(expected)
      })

      it('with count instead to', async () => {
        let result = await request(opts, '/v2/headers/query?from=2&count=1')
        expect(result).to.deep.equal({
          from: 2,
          count: 1,
          headers: await getHeader(3)
        })
      })
    })
  })
}
