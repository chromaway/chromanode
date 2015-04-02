# API

Chromanode using [socket.io](https://github.com/Automattic/socket.io) as transport layer and similar [json-rpc](http://www.jsonrpc.org/) interface for calling api methods.

## Methods:

  * [version](#version)
  * [getinfo](#getinfo)
  * [getlastheader](#getlastheader)
  * [getheaders](#getheaders)
  * [gettx](#gettx)
  * [getmerkle](#getmerkle)
  * [sendtx](#sendtx)
  * [queryaddresses](#queryaddresses)
  * [subscribe](#subscribe)

### version

  **result**

    {"version": "a.b.c"}

### getinfo

  **result**

    {
      "bitcoind": {
        "version": 99900,
        "protocolversion": 70002,
        "blocks": 329741,
        "connections": 8,
        "difficulty": 1,
        "testnet": true,
        "errors": "This is a pre-release test build - use at your own risk - do not use for mining or merchant applications"
      },
      "chromanode": {
        "blocks": 329736,
        "lastHash": "000000002eb3d5d9cac7d04b56f6d0afba66b46bd3715f0c56a240ef7b491937",
        "version": "a.b.c"
      }
    }

### getlastheader

  **result**

    {
      "height": 329741,
      "blockid": "00000000f872dcf2242fdf93ecfe8da1ba02304ea6c05b56cb828d3c561e9012",
      "header": "02000000f71f5d49b11756cbf9c2b9b53d...1d0047ed74" // 80 bytes
    }

### getheaders

  *maximum 2016 headers for one request*

  *used half-open interval for [from-to)*

  **params**

    // get 1 header for by height
    {"from": 150232, "count": 1}

    // alternative request, also get 1 header
    {"from": 150232, "to": 150233}

    // get header by blockid
    {
      "from": "00000000f872dcf2242fdf93ecfe8da1ba02304ea6c05b56cb828d3c561e9012",
      "count": 1
    }

    // get first chunk (count omitted, because getheaders return maximum 2016 headers)
    {"from": 0}

  **result**

    {
      "from": 329741,
      "count": 2,
      "headers": "00000000f872dcf2242fdf93ecfe8da1ba02304e...69a632dcb" // 160 bytes
    }

  **error**

    {"name": "FromNotFound"}
    {"name": "ToNotFound"}
    {"name": "ToVeryFar"}

### gettx

  **params**

    {"txid": "fba4a74006c51bdf5efdc69c7a9a6e188a2a0de62486f2719d8335bb96984932"}

  **result**

    {"rawtx": "01000000013e465651b1b93449967a04...a20311b2bd9b088ac00000000"}

  **error**

    {"name": "TxNotFound"}

### getmerkle

  **params**

    {"txid": "d04888787b942ae2d81a878048d29640e5bcd109ebfe7dd2abdcd8e9ce8b5453"}

  **result**

    // for unconfirmed transactions
    {"status": "unconfirmed"}

    // for confirmed transactions
    {
      "status": "confirmed",
      "data": {
        "height": 103548,
        "blockid": "d04888787b942ae2d81a878048d29640e5bcd109ebfe7dd2abdcd8e9ce8b5453",
        "merkle": [
          "8894f3284e9fa1121b0b8935a211c4988db4fc2e44640f4da7a85eb6ea4652c7",
          "5f9829e099080e3b22933972b9428e6650163ef0b5a9498696d4599c6e30985f",
          "dd3f8d347786991cdf39abae6252474291711031247a1c1d5e2d27aa0964c6c8",
          "3d20e80d705bbf73b3dea3c08c970a756ea1d79b0f2500282be76fbbff303a49"
        ],
        "index": 2
      }
    }

  **error**

    {"name": "TxNotFound"}

### sendtx

  **params**

    {"rawtx": "01000000013e465651b1b93449967a04...a20311b2bd9b088ac00000000"}

  **result**

    {"txid": "fba4a74006c51bdf5efdc69c7a9a6e188a2a0de62486f2719d8335bb96984932"}

  **error**

    {"name": "SendTx", "message": "already in block chain"}

### queryaddresses

  *used half-closed interval for (from-to]*

  **params**

    // get all affected transactions for addresses
    {
      "addresses": [
        "mkXsnukPxC8FuEFEWvQdJNt6gvMDpM8Ho2",
        "msGccLNBLYWBg9U1J2RVribprvsEF3uYGK"
      ]
    }

    // all affected transactions with unspent outputs from height #103548
    {
      "addresses": ["mkXsnukPxC8FuEFEWvQdJNt6gvMDpM8Ho2"],
      "source": "blocks",
      "from": 103548,
      "status": "unspent"
    }

    // all affected transactions from mempool
    {
      "addresses": ["mkXsnukPxC8FuEFEWvQdJNt6gvMDpM8Ho2"],
      "source": "mempool"
    }

    // all affected transactions for half-closed interval (fromBlockId, toBlockId]
    {
      "address": "mkXsnukPxC8FuEFEWvQdJNt6gvMDpM8Ho2",
      "source": "blocks",
      "from": "0000000048f98df71a9d3973c55ac5543735f8ef801603caea2bdf22d77e8354",
      "to": "0000000011ab0934769901d4acde41e48a98a7cdaf9d7626d094e66368443560"
    }

  **result**

    // source is blocks
    {
      "transactions": [{
        "txid": "5f450e47d9ae60f156d366418442f7c454fd4a343523edde7776af7a7d335ac6",
        "height": 318345
      }, ... {
        "txid": "fba4a74006c51bdf5efdc69c7a9a6e188a2a0de62486f2719d8335bb96984932",
        "height": 329740
      }],
      lastBlock: {
        "height": 329750,
        "blockid": "0000000045dd9bad2000dd00b31762c3da32ac46f40cdf4ddd350bcc3571a253"
      }
    }

    // source is mempool
    {
      "transactions": [
        "ab139c6e7054d086ca65f1b7173ee31ef39a1d0ad1797b4addd82f4028dfa0d1",
        ...
        "c839eafa86638520d4f05b48dc2a38cd1498bde5165df59242e6003fdde86a15"
      ]
    }

  **error**

    {"name": "FromNotFound"}
    {"name": "ToNotFound"}

### subscribe

  **params**

    // subscribe on new blocks
    {"type": "blocks"}

    // subscribe on address events
    {"type": "address", "address": "mkXsnukPxC8FuEFEWvQdJNt6gvMDpM8Ho2"}

  **result**

    // response on subscription, even if was already subscribed
    {"status": "subscribed"}

    // new block
    {
      "type": "blocks",
      "data": {
        "height": 329752,
        "blockid": "00000000d5a544abffd4c14d596604c4588fef7a53d2cc33533709c9a2f485a5"
      }
    }

    // address, when:
    //  * transaction pushed to network
    //  * transaction included in block
    {
      "type": "address",
      "data": {
        "address": "mkXsnukPxC8FuEFEWvQdJNt6gvMDpM8Ho2",
        "txid": "c51d0092e67034333b4271720d2138825cdb8778b812900c89fdae8de10e9c46"
      }
    }
