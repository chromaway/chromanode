module.exports = {
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

      txids: 'SELECT ' +
             '    txids as txids ' +
             '  FROM blocks ' +
             '    WHERE ' +
             '      height = $1'
    },
    transactions: {
      has: 'SELECT ' +
           '    COUNT(*) ' +
           '  FROM transactions ' +
           '    WHERE ' +
           '      txid = $1',

      unconfirmed: 'SELECT ' +
                   '    txid as txid ' +
                   '  FROM transactions ' +
                   '    WHERE ' +
                   '      height is null'
    }
  },
  update: {
    transactions: {
      makeConfirmed: 'UPDATE transactions ' +
                     '  SET ' +
                     '    height = $1 ' +
                     '  WHERE ' +
                     '    txid = $2'
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

      makeConfirmed: 'UPDATE history ' +
                     '  SET ' +
                     '    iheight = $1, ' +
                     '    oheight = $1 ' +
                     '  WHERE ' +
                     '    itxid = $2 OR ' +
                     '    otxid = $2 ' +
                     '  RETURNING ' +
                     '    address',

      deleteInputsFromHeight: 'UPDATE history ' +
                              '  SET ' +
                              '    itxid = NULL, ' +
                              '    iheight = NULL ' +
                              '  WHERE ' +
                              '    iheight > $1',

      deleteUnconfirmedInputs: 'UPDATE history ' +
                               '  SET ' +
                               '    itxid = NULL ' +
                               '  WHERE ' +
                               '    itxid IS NOT NULL AND' +
                               '    iheight IS NULL',

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
      fromHeight: 'DELETE FROM transactions ' +
                  '  WHERE ' +
                  '    height > $1',

      unconfirmed: 'DELETE FROM transactions ' +
                   '  WHERE ' +
                   '    height IS NULL',

      unconfirmedByTxIds: 'DELETE FROM transactions ' +
                          '  WHERE ' +
                          '    txid = ANY($1)'
    },
    history: {
      fromHeight: 'DELETE FROM history ' +
                  '  WHERE ' +
                  '    oheight > $1',

      unconfirmed: 'DELETE FROM history ' +
                   '  WHERE ' +
                   '    oheight IS NULL',

      unconfirmedByTxIds: 'DELETE FROM history ' +
                          '  WHERE ' +
                          '    otxid = ANY($1)'
    }
  }
}
