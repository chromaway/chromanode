import _ from 'lodash'
import { expect } from 'chai'
import bitcore from 'bitcore'
import cclib from 'coloredcoinjs-lib'
import PUtils from 'promise-useful-utils'

export default function (opts) {
  let request = require('../request')(opts)
  let preload
  let gTx
  let tTx

  function composedTx2bitcoreTx (comptx) {
    let tx = new bitcore.Transaction()

    comptx.getInputs().forEach(function (input) {
      tx.from({
        txId: input.txId,
        outputIndex: input.outIndex,
        script: input.script,
        satoshis: input.value
      })
      _.last(tx.inputs).sequenceNumber = input.sequence
    })

    comptx.getOutputs().forEach(function (output) {
      tx.addOutput(new bitcore.Transaction.Output({
        script: output.script,
        satoshis: output.value
      }))
    })

    return tx
  }

  before(async () => {
    preload = await opts.bitcoind.getPreload()

    // create genesis tx
    let gcdef = cclib.definitions.Manager.getGenesis()
    let cvalue = new cclib.ColorValue(gcdef, 500000)
    let tscript = bitcore.Script.buildPublicKeyHashOut(preload.privKey.toPublicKey()).toHex()
    let ctarget = new cclib.ColorTarget(tscript, cvalue)

    let optx = new cclib.tx.SimpleOperational({
      targets: [
        ctarget
      ],
      coins: {
        0: [{
          txId: preload.txId,
          outIndex: preload.outIndex,
          value: preload.value,
          script: preload.script
        }]
      },
      changeAddresses: {
        0: preload.privKey.toAddress().toString()
      },
      fee: 0
    })

    let comptx = await cclib.definitions.EPOBC.composeGenesisTx(optx)
    gTx = composedTx2bitcoreTx(comptx).sign(preload.privKey)
    let response = await opts.bitcoind.rpc.sendRawTransaction(gTx.toString())
    expect(response.result).to.equal(gTx.id)

    // create transfer tx
    let cdef = await cclib.definitions.EPOBC.fromDesc(`epobc:${gTx.id}:0:0`, 1)
    cvalue = new cclib.ColorValue(cdef, 100000)
    tscript = bitcore.Script.buildPublicKeyHashOut(preload.privKey.toPublicKey()).toHex()
    ctarget = new cclib.ColorTarget(tscript, cvalue)

    optx = new cclib.tx.SimpleOperational({
      targets: [
        ctarget
      ],
      coins: {
        0: [{
          txId: gTx.id,
          outIndex: 1,
          value: gTx.outputs[1].satoshis,
          script: gTx.outputs[1].script.toHex()
        }],
        1: [{
          txId: gTx.id,
          outIndex: 0,
          value: 500000,
          script: gTx.outputs[0].script.toHex()
        }]
      },
      changeAddresses: {
        0: preload.privKey.toAddress().toString(),
        1: preload.privKey.toAddress().toString()
      },
      fee: 0
    })

    comptx = await cclib.definitions.EPOBC.makeComposedTx(optx)
    tTx = composedTx2bitcoreTx(comptx).sign(preload.privKey)
    let addedPromise = opts.waitTextInScanner(tTx.id)
    response = await opts.bitcoind.rpc.sendRawTransaction(tTx.toString())
    expect(response.result).to.equal(tTx.id)
    await addedPromise
    await PUtils.sleep(250)
  })

  describe('colored coins', () => {
    describe('getAllColoredCoins', () => {
      it('InvalidColor', async () => {
        let txId = bitcore.crypto.Random.getRandomBuffer(32).toString('hex')
        let color = `epobc:${txId}:0:0`

        try {
          await request.post('/v2/cc/getAllColoredCoins', {color: color})
        } catch (err) {
          expect(err).to.be.instanceof(request.errors.StatusFail)
          expect(err.data).to.have.property('type', 'InvalidColor')
          expect(err.data).to.have.property('message', color)
        }
      })

      it('success', async () => {
        let color = `epobc:${gTx.id}:0:0`
        let result = await request.post('/v2/cc/getAllColoredCoins', {color: color})
        expect(result).to.deep.equal({
          coins: [{
            txId: gTx.id,
            outIndex: 0,
            height: null,
            colorValue: 500000
          }, {
            txId: tTx.id,
            outIndex: 0,
            height: null,
            colorValue: 100000
          }, {
            txId: tTx.id,
            outIndex: 1,
            height: null,
            colorValue: 400000
          }]
        })
      })
    })

    describe('getTxColorValues', () => {
      it('not color tx', async () => {
        let txHex = (await opts.bitcoind.rpc.getRawTransaction(preload.txId)).result
        let tx = bitcore.Transaction(txHex)

        let result = await request.post('/v2/cc/getTxColorValues', {txId: preload.txId})
        expect(result).to.deep.equal({
          colorValues: new Array(tx.outputs.length).fill(null)
        })
      })

      it('outIndices and outIndex is ommited', async () => {
        let result = await request.post('/v2/cc/getTxColorValues', {txId: tTx.id})
        expect(result).to.deep.equal({
          colorValues: [{
            color: `epobc:${gTx.id}:0:0`,
            value: 100000
          }, {
            color: `epobc:${gTx.id}:0:0`,
            value: 400000
          },
          null
          ]
        })
      })

      it('use outIndex', async () => {
        let result = await request.post('/v2/cc/getTxColorValues', {txId: tTx.id, outIndex: 0})
        expect(result).to.deep.equal({
          colorValues: [{
            color: `epobc:${gTx.id}:0:0`,
            value: 100000
          },
          null,
          null
          ]
        })
      })
    })
  })
}
