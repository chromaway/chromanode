module.exports = {
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
             '    hash as hash, ' +
             '    txids as txids ' +
             '  FROM blocks ' +
             '    WHERE ' +
             '      height = $1',

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
               '      height > $1 AND height <= $2 ' +
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
    }
  }
}
