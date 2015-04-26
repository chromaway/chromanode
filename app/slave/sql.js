module.exports = {
  select: {
    blocks: {
      txids: 'SELECT ' +
             '    hash as hash, ' +
             '    txids as txids ' +
             '  FROM blocks ' +
             '    WHERE ' +
             '      height = $1'
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
