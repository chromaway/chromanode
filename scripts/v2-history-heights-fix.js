import _ from 'lodash'
import PUtils from 'promise-useful-utils'

let pg = PUtils.promisifyAll(require('pg').native)
let SQL = {
  select: {
    txidsByHeight: 'SELECT txids FROM blocks WHERE height = $1'
  },
  update: {
    oheight: 'UPDATE history SET oheight = $1 WHERE otxid = ANY($2)',
    iheight: 'UPDATE history SET iheight = $1 WHERE itxid = ANY($2)'
  }
}

let pgURL = 'postgres://kirill@localhost/chromanode_testnet'
let startHeight = 0

;(async function () {
  let [client, done] = await pg.connectAsync(pgURL)
  try {
    for (let height = startHeight; ; height += 1) {
      let {rows} = await client.queryAsync(SQL.select.txidsByHeight, [height])
      if (rows.length === 0) {
        console.log(`Block for height (${height}) not found! Finished!`)
        break
      }

      let txids = rows[0].txids.toString('hex')
      txids = _.times(txids.length / 64).map((i) => {
        return txids.slice(i * 64, (i + 1) * 64)
      })

      await* [
        client.queryAsync(SQL.update.oheight, [height, txids]),
        client.queryAsync(SQL.update.iheight, [height, txids])
      ]

      console.log(`Update heights for height: ${height}, txids count: ${txids.length}`)
    }
  } catch (err) {
    console.log(err)
  }
  done()
  pg.end()
})()
