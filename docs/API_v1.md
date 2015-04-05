# API v1

Chromanode using [socket.io](https://github.com/Automattic/socket.io) for notification and HTTP for request.

  * [methods](#methods)
  * [notifications](#notifications)

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

    /v1/status

  **result**

    {
      "bitcoind": {
        "version": 99900,
        "protocolversion": 70002,
        "blocks": 329741,
        "connections": 8,
        "difficulty": 1,
        "testnet": true,
        "errors": "This is a pre-release test build - use at your own risk - do not use for mining or merchant applications",
        ...
      },
      "chromanode": {
        "status": "starting|syncing|finished",
        "latest": {
          "height": 329736,
          "blockid": "000000002eb3d5d9cac7d04b56f6d0afba66b46bd3715f0c56a240ef7b491937",
        },
        "version": "a.b.c"
      }
    }

### Headers

#### Latest

  **url**

    /v1/headers/latest

  **result**

    {
      "height": 329741,
      "blockid": "00000000f872dcf2242fdf93ecfe8da1ba02304ea6c05b56cb828d3c561e9012",
      "header": "02000000f71f5d49b11756cbf9c2b9b53d...1d0047ed74" // 80 bytes
    }

#### Query

  Return raw headers for custom query.

  \* *maximum 2016 headers (one chunk)*

  \* *half-open interval for [from-to)*

  **url**

    /v1/headers/query

  **query**

| param | description                                              |
|:------|:---------------------------------------------------------|
| from  | blockid or height                                        |
| to    | blockid or height, may be omitted (preferred than count) |
| count | number, may be omitted                                   |

    // get 1 header by height
    /v1/headers/query?from=150232&count=1

    // alternative request, also get 1 header
    /v1/headers/query?from=150232&to=150233

    // get header by blockid
    /v1/headers/query?from=00000000f872dcf...cb828d3c561e9012&count=1

    // get first chunk (count omitted, because query return maximum 2016 headers)
    /v1/headers/query?from=0

  **result**

    {
      "from": 329741,
      "count": 2,
      "headers": "00000000f872dcf2242fdf93ecfe8da1ba02304e...69a632dcb" // 160 bytes
    }

  **errors**

    {"type": "InvalidHeight"}
    {"type": "InvalidHash"}
    {"type": "FromNotFound"}
    {"type": "ToNotFound"}
    {"type": "InvalidRequestedCount"}
    {"type": "InvalidCount"}

### Transactions

#### Raw

#### Merkle

#### Send

### Addresses

#### Query

  \* *half-close interval for (from-to]*

  **url**

    /v1/addresses/query

  **query**

| param     | description                                           |
|:----------|:------------------------------------------------------|
| addresses | array of addresses                                    |
| source    | blocks or mempool, may be omitted (both will be used) |
| from      | blockid or height, may be omitted                     |
| to        | blockid or height, may be omitted                     |
| status    | now only unspent available, may be omitted            |

    // get all affected transactions for addresses (from blocks and mempool)
    /v1/addresses/query?addresses=mkXsnukPxC8FuEFEWvQdJNt6gvMDpM8Ho2,msGccLNBLYWBg9U1J2RVribprvsEF3uYGK

    // all affected transactions from blocks that have at least one unspent output from height #103548
    /v1/addresses/query?addresses=mkXsnukPxC8FuEFEWvQdJNt6gvMDpM8Ho2&source=blocks&from=103548&status=unspent

    // all affected transactions from mempool
    /v1/addresses/query?addresses=mkXsnukPxC8FuEFEWvQdJNt6gvMDpM8Ho2&source=mempool

    // all affected transactions for half-closed interval (fromBlockId, toBlockId]
    /v1/addresses/query?addresses=mkXsnukPxC8FuEFEWvQdJNt6gvMDpM8Ho2&from=0000000048f98df71a9d3973c55ac5543735f8ef801603caea2bdf22d77e8354&to=0000000011ab0934769901d4acde41e48a98a7cdaf9d7626d094e66368443560

  **result**

    // for mempool height is null
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
      latest: {
        "height": 329750,
        "blockid": "0000000045dd9bad2000dd00b31762c3da32ac46f40cdf4ddd350bcc3571a253"
      }
    }

  **errors**

    {"type": "AddressesRequired"}
    {"type": "InvalidAddresses"}
    {"type": "InvalidSource"}
    {"type": "InvalidHeight"}
    {"type": "InvalidHash"}
    {"type": "FromNotFound"}
    {"type": "ToNotFound"}
    {"type": "InvalidStatus"}

## Notifications:

  * [new-blocks](#new-blocks)
  * [address-txid](#address-txid)

### New-blocks

### Address-txid
