# API v1

Chromanode using [socket.io](https://github.com/Automattic/socket.io) for notification and HTTP for request.

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

## Notifications:

  * [new-blocks](#new-blocks)
  * [address-txid](#address-txid)

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

  *maximum 2016 headers (one chunk)*

  *half-open interval for [from-to)*

  **url**

    /v1/headers/query

  **params**

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
