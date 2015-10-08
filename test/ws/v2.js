import _ from 'lodash'
import { expect } from 'chai'
import io from 'socket.io-client'
import bitcore from 'bitcore'
import PUtils from 'promise-useful-utils'

export default function (opts) {
  describe('v2', () => {
    let socket

    let subscribe = (opts) => {
      return new Promise((resolve, reject) => {
        socket.once('subscribed', (payload, err) => {
          try {
            expect(payload).to.deep.equal(opts)
            expect(err).to.be.null
            resolve()
          } catch (err) {
            reject(err)
          }
        })
        socket.emit('subscribe', opts)
      })
    }

    beforeEach(async () => {
      socket = io(`ws://127.0.0.1:${opts.ports.service}/v2`, {
        autoConnect: false,
        forceNew: true,
        forceJSONP: false,
        jsonp: false,
        transports: ['polling']
      })

      await new Promise((resolve) => {
        socket.once('connect', resolve)
        socket.connect()
      })
    })

    afterEach(async () => {
      await new Promise((resolve) => {
        socket.once('disconnect', resolve)
        socket.disconnect()
      })
    })

    it('subscribe/unsubscribe', async () => {
      await subscribe({type: 'status'})
      await new Promise((resolve, reject) => {
        socket.once('unsubscribed', (payload, err) => {
          try {
            expect(payload).to.deep.equal({type: 'status'})
            expect(err).to.be.null
            resolve()
          } catch (err) {
            reject(err)
          }
        })
        socket.emit('unsubscribe', {type: 'status'})
      })

      await new Promise((resolve, reject) => {
        PUtils.try(async () => {
          socket.once('status', () => { reject() })
          await opts.bitcoind.generateBlocks(1)
          setTimeout(resolve, 500)
        })
        .catch(reject)
      })
    })

    it('new-block', async () => {
      await subscribe({type: 'new-block'})
      await new Promise((resolve, reject) => {
        PUtils.try(async () => {
          let blockHash
          socket.once('new-block', async (payload) => {
            try {
              expect(payload).to.deep.equal({
                hash: blockHash,
                height: (await opts.bitcoind.rpc.getBlockCount()).result
              })
              resolve()
            } catch (err) {
              reject(err)
            }
          })
          blockHash = (await opts.bitcoind.generateBlocks(1))[0]
        })
        .catch(reject)
      })
    })

    it('new-tx & tx', async () => {
      let txId

      await subscribe({type: 'new-tx'})
      await new Promise((resolve, reject) => {
        PUtils.try(async () => {
          socket.once('new-tx', async (payload) => {
            try {
              expect(payload).to.deep.equal({
                txid: txId,
                blockHash: null,
                blockHeight: null
              })
              resolve()
            } catch (err) {
              reject(err)
            }
          })
          txId = (await opts.bitcoind.generateTxs(1))[0]
        })
        .catch(reject)
      })

      await subscribe({type: 'tx', txid: txId})
      await new Promise((resolve, reject) => {
        PUtils.try(async () => {
          let blockHash
          socket.once('tx', async (payload) => {
            try {
              expect(payload).to.deep.equal({
                txid: txId,
                blockHash: blockHash,
                blockHeight: (await opts.bitcoind.rpc.getBlockCount()).result
              })
              resolve()
            } catch (err) {
              reject(err)
            }
          })
          blockHash = (await opts.bitcoind.generateBlocks(1))[0]
        })
        .catch(reject)
      })
    })

    it('address', async () => {
      let preload = await opts.bitcoind.getPreload()
      let fromAddress = preload.privKey.toAddress().toString()
      let toAddress = bitcore.PrivateKey('regtest').toAddress().toString()
      let tx = bitcore.Transaction()
        .from({
          txId: preload.txId,
          outputIndex: preload.outIndex,
          satoshis: preload.value,
          script: preload.script
        })
        .to(toAddress, preload.value - 1e4)
        .sign(preload.privKey)

      await subscribe({type: 'address', address: fromAddress})
      await subscribe({type: 'address', address: toAddress})

      await new Promise((resolve, reject) => {
        PUtils.try(async () => {
          let addresses = [fromAddress, toAddress]
          let onAddress = (payload) => {
            try {
              let obj = {
                address: fromAddress,
                txid: tx.id,
                blockHash: null,
                blockHeight: null
              }
              if (_.get(payload, 'address') === toAddress) {
                obj.address = toAddress
              }

              expect(payload).to.deep.equal(obj)

              expect(addresses).to.include(payload.address)
              addresses = _.without(addresses, payload.address)

              if (addresses.length === 0) {
                socket.removeListener('address', onAddress)
                resolve()
              }
            } catch (err) {
              reject(err)
            }
          }

          socket.on('address', onAddress)

          let {result} = await opts.bitcoind.rpc.sendRawTransaction(tx.toString())
          expect(result).to.equal(tx.id)
        })
        .catch(reject)
      })

      await new Promise((resolve, reject) => {
        PUtils.try(async () => {
          let blockHash
          let addresses = [fromAddress, toAddress]
          let onAddress = async (payload) => {
            try {
              let obj = {
                address: fromAddress,
                txid: tx.id,
                blockHash: blockHash,
                blockHeight: (await opts.bitcoind.rpc.getBlockCount()).result
              }
              if (_.get(payload, 'address') === toAddress) {
                obj.address = toAddress
              }

              expect(payload).to.deep.equal(obj)

              expect(addresses).to.include(payload.address)
              addresses = _.without(addresses, payload.address)

              if (addresses.length === 0) {
                socket.removeListener('address', onAddress)
                resolve()
              }
            } catch (err) {
              reject(err)
            }
          }

          socket.on('address', onAddress)

          blockHash = (await opts.bitcoind.generateBlocks(1))[0]
        })
        .catch(reject)
      })
    })

    it('status', async () => {
      await subscribe({type: 'status'})
      await new Promise((resolve, reject) => {
        socket.once('status', (payload) => {
          try {
            expect(payload).to.have.property('version', require('../../package.json').version)
            expect(payload).to.have.property('network', 'regtest')
            resolve()
          } catch (err) {
            reject(err)
          }
        })
      })
    })
  })
}
