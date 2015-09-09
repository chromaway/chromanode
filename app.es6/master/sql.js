export default {
  insert: {
    blocks: {
      row: 'INSERT INTO blocks ' +
           '    (height, hash, header, txids) ' +
           '  VALUES ' +
           '    ($1, $2, $3, $4)'
    },
    transactions: {
      confirmed: 'INSERT INTO transactions ' +
                 '    (txid, height, tx) ' +
                 '  VALUES ' +
                 '    ($1, $2, $3)',
      unconfirmed: 'INSERT INTO transactions ' +
                   '    (txid, tx) ' +
                   '  VALUES ' +
                   '    ($1, $2)'
    },
    history: {
      confirmedOutput: 'INSERT INTO history ' +
                       '    (address, otxid, oindex, ovalue, oscript, oheight) ' +
                       '  VALUES ' +
                       '    ($1, $2, $3, $4, $5, $6)',
      unconfirmedOutput: 'INSERT INTO history ' +
                         '    (address, otxid, oindex, ovalue, oscript) ' +
                         '  VALUES ' +
                         '    ($1, $2, $3, $4, $5)'
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
      byHeight: 'SELECT ' +
                '    height as height, ' +
                '    hash as hash ' +
                '  FROM blocks ' +
                '    WHERE ' +
                '      height = $1',
      txids: 'SELECT ' +
             '    txids as txids ' +
             '  FROM blocks ' +
             '    WHERE ' +
             '      height = $1'
    },
    transactions: {
      exists: 'SELECT ' +
              '    COUNT(*) ' +
              '  FROM transactions ' +
              '    WHERE ' +
              '      txid = $1',
      existsMany: 'SELECT ' +
                  '    txid as txid ' +
                  '  FROM transactions ' +
                  '    WHERE txid = ANY($1)',
      unconfirmed: 'SELECT ' +
                   '    txid as txid ' +
                   '  FROM transactions ' +
                   '    WHERE ' +
                   '      height is null'
    }
  },
  update: {
    newTx: {
      getAndRemove: 'DELETE FROM new_txs WHERE id = $1 RETURNING hex'
    },
    transactions: {
      makeConfirmed: 'UPDATE transactions ' +
                     '  SET ' +
                     '    height = $1 ' +
                     '  WHERE ' +
                     '    txid = $2',
      makeUnconfirmed: 'UPDATE transactions ' +
                       '  SET ' +
                       '    height = NULL ' +
                       '  WHERE ' +
                       '    height > $1'
    },
    history: {
      addConfirmedInput: 'UPDATE history ' +
                         '  SET ' +
                         '    itxid = $1, ' +
                         '    iheight = $2 ' +
                         '  WHERE ' +
                         '    otxid = $3 AND ' +
                         '    oindex = $4 ' +
                         '  RETURNING ' +
                         '    address',
      addUnconfirmedInput: 'UPDATE history ' +
                           '  SET ' +
                           '    itxid = $1 ' +
                           '  WHERE ' +
                           '    otxid = $2 AND ' +
                           '    oindex = $3' +
                           '  RETURNING ' +
                           '    address',
      makeOutputConfirmed: 'UPDATE history ' +
                           '  SET ' +
                           '    oheight = $1 ' +
                           '  WHERE ' +
                           '    otxid = $2 ' +
                           '  RETURNING ' +
                           '    address',
      makeOutputsUnconfirmed: 'UPDATE history ' +
                              '  SET ' +
                              '    oheight = NULL ' +
                              '  WHERE ' +
                              '    oheight > $1',
      makeInputConfirmed: 'UPDATE history ' +
                           '  SET ' +
                           '    iheight = $1 ' +
                           '  WHERE ' +
                           '    otxid = $2 AND' +
                           '    oindex = $3 ' +
                           '  RETURNING ' +
                           '    address',
      makeInputsUnconfirmed: 'UPDATE history ' +
                             '  SET ' +
                             '    iheight = NULL ' +
                             '  WHERE ' +
                             '    iheight > $1',
      deleteUnconfirmedInputsByTxIds: 'UPDATE history ' +
                                      '  SET ' +
                                      '    itxid = NULL ' +
                                      '  WHERE ' +
                                      '    itxid = ANY($1)'
    }
  },
  delete: {
    blocks: {
      fromHeight: 'DELETE FROM blocks ' +
                  '  WHERE ' +
                  '    height > $1'
    },
    transactions: {
      unconfirmedByTxIds: 'DELETE FROM transactions ' +
                          '  WHERE ' +
                          '    txid = ANY($1)'
    },
    history: {
      unconfirmedByTxIds: 'DELETE FROM history ' +
                          '  WHERE ' +
                          '    otxid = ANY($1)'
    }
  }
}
