# API v2

Chromanode uses [socket.io](https://github.com/Automattic/socket.io) for notification and HTTP for request.

  * [methods](#methods)
  * [notifications](#notifications)
  * [errors](#errors)

## Methods:

  * [status](#status)
  * [headers](#headers)
    * [latest](#latest)
    * [query](#query)
  * [transactions](#transactions)
    * [raw](#raw)
    * [merkle](#merkle)
    * [send](#send)
  * [addresses](#addresses)
    * [query](#query)

### Status

  **url**

    /v2/status

  **result**

    {
      "version": "a.b.c",
      "network": "livenet|testnet",
      "progress": "0.943264",
      "latest": {
        "hash": "000000002eb3d5d9cac7d04b56f6d0afba66b46bd3715f0c56a240ef7b491937",
        "height": 329736
      },
      "bitcoind": {
        "version": 99900,
        "protocolversion": 70002,
        "connections": 8,
        "errors": "Warning: This version is obsolete, upgrade required!",
        "latest": {
          "hash": "0000000037859e0b71704e4a24093ca809d4058923af42844d0a3990b191e1fa",
          "height": 349569
        }
      }
    }

### Headers

#### Latest

  **url**

    /v2/headers/latest

  **result**

    {
      "height": 329741,
      "hash": "00000000f872dcf2242fdf93ecfe8da1ba02304ea6c05b56cb828d3c561e9012",
      "header": "02000000f71f5d49b11756cbf9c2b9b53d...1d0047ed74" // 80 bytes
    }

#### Query

  Return raw headers for custom query.

  \* *half-open interval for (from-to]*

  \* *maximum 2016 headers (one chunk)*

  **url**

    /v2/headers/query

  **query**

| param | description                                                       |
|:------|:------------------------------------------------------------------|
| from  | hash or height, may be ommited (include zero header in this case) |
| to    | hash or height, may be omitted (preferred than count)             |
| count | number, may be omitted                                            |

    // get 1 header by height
    /v2/headers/query?from=150232&count=1

    // alternative request, also get 1 header
    /v2/headers/query?from=150232&to=150233

    // get header by hash
    /v2/headers/query?from=00000000f872dcf...cb828d3c561e9012&count=1

    // get first chunk (count omitted, because query return maximum 2016 headers)
    /v2/headers/query?

  **result**

    {
      "from": 329741,
      "count": 2,
      "headers": "00000000f872dcf2242fdf93ecfe8da1ba02304e...69a632dcb" // 160 bytes
    }

  **errors**

    {"type": "FromNotFound"}
    {"type": "InvalidCount"}
    {"type": "InvalidHash"}
    {"type": "InvalidHeight"}
    {"type": "InvalidRequestedCount"}
    {"type": "ToNotFound"}

### Transactions

#### Raw

  **url**

    /v2/transactions/raw

  **query**

| param | description    |
|:------|:---------------|
| txid  | transaction id |

    /v2/transactions/raw?txid=f9f12dafc3d4ca3fd9cdf293873ad1c6b0bddac35dcd2bd34a57320772def350

  **result**

    {"hex": "010000000161ad9192...277c850ef12def7248188ac00000000"}

  **errors**

    {"type": "InvalidTxId"}
    {"type": "TxNotFound"}

#### Merkle

  **url**

    /v2/transactions/merkle

  **query**

| param | description    |
|:------|:---------------|
| txid  | transaction id |

    /v2/transactions/merkle?txid=d04888787b942ae2d81a878048d29640e5bcd109ebfe7dd2abdcd8e9ce8b5453

  **result**

    // for unconfirmed transactions
    {"source": "mempool"}

    // for confirmed transactions
    {
      "source": "blocks",
      "block": {
        "height": 103548,
        "hash": "0000000048f98df71a9d3973c55ac5543735f8ef801603caea2bdf22d77e8354",
        "merkle": [
          "8894f3284e9fa1121b0b8935a211c4988db4fc2e44640f4da7a85eb6ea4652c7",
          "5f9829e099080e3b22933972b9428e6650163ef0b5a9498696d4599c6e30985f",
          "dd3f8d347786991cdf39abae6252474291711031247a1c1d5e2d27aa0964c6c8",
          "3d20e80d705bbf73b3dea3c08c970a756ea1d79b0f2500282be76fbbff303a49"
        ],
        "index": 2
      }
    }

  **errors**

    {"type": "InvalidTxId"}
    {"type": "TxNotFound"}

#### Send

  **url**

    /v2/transactions/send

  **query**

| param | description     |
|:------|:----------------|
| rawtx | raw transaction |

    curl http://localhost:3001/v2/transactions/send --header "Content-Type:application/json" -d '{"rawtx": "..."}'

  **result**

    empty response if success

  **errors**

    {"type": "SendTxError", "code": -8, "message": "parameter must be hexadeci..."}

### Addresses

#### Query

  \* *half-close interval for (from-to]*

  **url**

    /v2/addresses/query

  **query**

| param     | description                                           |
|:----------|:------------------------------------------------------|
| addresses | array of addresses                                    |
| source    | blocks or mempool, may be omitted (both will be used) |
| from      | hash or height, may be omitted                        |
| to        | hash or height, may be omitted                        |
| status    | transactions or unspent, may be omitted               |

    // get all affected transactions for addresses (from blocks and mempool)
    /v2/addresses/query?addresses=mkXsnukPxC8FuEFEWvQdJNt6gvMDpM8Ho2,msGccLNBLYWBg9U1J2RVribprvsEF3uYGK

    // all affected transactions from blocks that have at least one unspent output from height #103548
    /v2/addresses/query?addresses=mkXsnukPxC8FuEFEWvQdJNt6gvMDpM8Ho2&source=blocks&from=103548&status=unspent

    // all affected transactions from mempool
    /v2/addresses/query?addresses=mkXsnukPxC8FuEFEWvQdJNt6gvMDpM8Ho2&source=mempool

    // all affected transactions for half-closed interval (fromHash, toHash]
    /v2/addresses/query?addresses=mkXsnukPxC8FuEFEWvQdJNt6gvMDpM8Ho2&from=0000000048f98df71a9d3973c55ac5543735f8ef801603caea2bdf22d77e8354&to=0000000011ab0934769901d4acde41e48a98a7cdaf9d7626d094e66368443560

  **result**

    // empty status, for mempool transactions height is null
    {
      "transactions": [{
        "txid": "5f450e47d9ae60f156d366418442f7c454fd4a343523edde7776af7a7d335ac6",
        "height": 318345
      }, ... {
        "txid": "fba4a74006c51bdf5efdc69c7a9a6e188a2a0de62486f2719d8335bb96984932",
        "height": 329740
      }, {
        "txid": "ab139c6e7054d086ca65f1b7173ee31ef39a1d0ad1797b4addd82f4028dfa0d1",
        "height": null
      }],
      "latest": {
        "height": 329750,
        "hash": "0000000045dd9bad2000dd00b31762c3da32ac46f40cdf4ddd350bcc3571a253"
      }
    }

    // status is unspent
    {
      "unspent": [{
        "txid", "a9566f182b27355b4a7470d7fd77809ba0a5a3d19831e271516fe38584c33dee",
        "vout": 0,
        "value": 5000000000,
        "script": "76a914c3d093c756dc4f8dd817b503c64ecb802776213488ac",
        "height": 130241
      }, ... {
        "txid": "ddd1b0bfefcac0163d1b9298a520d4b90b0bffe8947caf0989ffa6da0f536a99",
        "vout": 0,
        "value": 330000,
        "script": "76a9143ee467c487c69df0828614f27bdb55eb7c4d679d88ac",
        "height": null
      }],
      "latest": {
        "height": 329750,
        "hash": "0000000045dd9bad2000dd00b31762c3da32ac46f40cdf4ddd350bcc3571a253"
      }
    }

  **errors**

    {"type": "FromNotFound"}
    {"type": "InvalidAddresses"}
    {"type": "InvalidHash"}
    {"type": "InvalidHeight"}
    {"type": "InvalidSource"}
    {"type": "InvalidStatus"}
    {"type": "ToNotFound"}

## Notifications:

  * [new-block](#new-block)
  * [new-tx](#new-tx)
  * [tx](#tx)
  * [address](#address)
  * [status](#status)

### new-block

```js
    var io = require('socket.io-client')
    var socket = io('http://localhost:3001')
    socket.on('connect', function () {
      socket.emit('subscribe', {type: 'new-block'})
    })
    socket.on('new-block', function (payload) {
      console.log(
        'New block ' + payload.hash + '! (height: ' + payload.height + ')')
    })
```

### new-tx

```js
    var io = require('socket.io-client')
    var socket = io('http://localhost:3001')
    socket.on('connect', function () {
      socket.emit('subscribe', {type: 'new-tx'})
    })
    socket.on('new-tx', function (payload) {
      console.log('New tx:', payload.txid)
    })
```

### tx

```js
    var tx = new require('bitcore').Transaction()
      .from(...)
      .to(...)
      .change(...)
      .sign(...)

    var io = require('socket.io-client')
    var socket = io('http://localhost:3001')
    socket.on('connect', function () {
      socket.emit('subscribe', {type: 'tx', txid: tx.hash})
      blockchain.propagate(tx.toString()) // broadcast tx ...
    })
    socket.on('tx', function (payload) {
      if (payload.txid !== tx.hash || payload.blockHash === null) {
        return
      }

      console.log('Tx included in block ', payload.blockHeight)
      socket.emit('unsubscribe', {type: 'tx', txid: tx.hash})
    })
```

### address

```js
    var io = require('socket.io-client')
    var socket = io('http://localhost:3001')
    socket.on('connect', function () {
      socket.emit('subscribe', {
        type: 'address',
        address: 'mkXsnukPxC8FuEFEWvQdJNt6gvMDpM8Ho2'
      })
    })
    socket.on('address', function (payload) {
      console.log('New affected tx:', payload.txid)
    })
```

### status

```js
    var io = require('socket.io-client')
    var socket = io('http://localhost:3001')
    socket.on('connect', function () {
      socket.emit('subscribe', {type: 'status'})
    })
    socket.on('status', function (status) {
      console.log('New status:', status)
    })
```

## Errors

  * FromNotFound
  * InvalidAddresses
  * InvalidCount
  * InvalidHash
  * InvalidHeight
  * InvalidRequestedCount
  * InvalidTxId
  * InvalidSource
  * InvalidStatus
  * SendTxError
  * ToNotFound
  * TxNotFound
