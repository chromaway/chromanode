export default {
  insert: {
    newTx: {
      row: 'INSERT INTO new_txs (hex) VALUES ($1) RETURNING id'
    }
  },
  select: {
    blocks: {
      latest: 'SELECT ' +
              '    height as height, ' +
              '    hash as hash, ' +
              '    header as header ' +
              '  FROM blocks ' +
              '    ORDER BY height DESC ' +
              '    LIMIT 1',
      txids: 'SELECT ' +
             '    blocks.height as height, ' +
             '    hash as hash, ' +
             '    txids as txids, ' +
             '    txid as txid ' +
             '  FROM blocks ' +
             '    RIGHT OUTER JOIN transactions ON ' +
             '      transactions.height = blocks.height ' +
             '    WHERE ' +
             '      txid = $1',
      heightByHash: 'SELECT ' +
                    '    height as height ' +
                    '  FROM blocks ' +
                    '    WHERE ' +
                    '      hash = $1',
      heightByHeight: 'SELECT ' +
                      '    height as height ' +
                      '  FROM blocks ' +
                      '    WHERE ' +
                      '      height = $1',
      headers: 'SELECT ' +
               '    header as header ' +
               '  FROM blocks ' +
               '    WHERE ' +
               '      height > $1 AND ' +
               '      height <= $2 ' +
               '    ORDER BY ' +
               '      height ASC'
    },
    transactions: {
      byTxId: 'SELECT ' +
              '    tx as tx, ' +
              '    height as height ' +
              '  FROM transactions ' +
              '    WHERE ' +
              '      txid = $1'
    },
    history: {
      transactions: 'SELECT ' +
                    '    otxid as otxid, ' +
                    '    oheight as oheight, ' +
                    '    itxid as itxid, ' +
                    '    iheight as iheight ' +
                    '  FROM history ' +
                    '    WHERE ' +
                    '      address = ANY($1)',
      unspent: 'SELECT ' +
               '    otxid as otxid, ' +
               '    oindex as oindex, ' +
               '    ovalue as ovalue, ' +
               '    oscript as oscript, ' +
               '    oheight as oheight ' +
               '  FROM history ' +
               '    WHERE ' +
               '      address = ANY($1) AND ' +
               '      itxid IS NULL',
      spent: 'SELECT ' +
             '    itxid as itxid, ' +
             '    iheight as iheight' +
             '  FROM history ' +
             '    WHERE ' +
             '      otxid = $1 AND ' +
             '      oindex = $2'
    }
  }
}
