module.exports = {
  select: {
    blocks: {
      latest: 'SELECT ' +
              '    height as height, ' +
              '    hash as hash, ' +
              '    header as header ' +
              '  FROM blocks ' +
              '    ORDER BY height DESC ' +
              '    LIMIT 1'
    }
  },
  update: {
    history: {
      deleteInputsFromHeight: 'UPDATE history ' +
                              '  SET ' +
                              '    itxid = NULL, ' +
                              '    iindex = NULL ' +
                              '  WHERE ' +
                              '    iheight > $1',

      deleteOutputsFromHeight: 'UPDATE history ' +
                               '  SET ' +
                               '    otxid = NULL, ' +
                               '    oindex = NULL, ' +
                               '    ovalue = NULL, ' +
                               '    oscript = NULL ' +
                               '  WHERE ' +
                               '    oheight > $1',

      deleteUnconfirmedInputs: 'UPDATE history ' +
                               '  SET ' +
                               '    itxid = NULL, ' +
                               '    iindex = NULL ' +
                               '  WHERE ' +
                               '    iheight is NULL',

      deleteUnconfirmedOutputs: 'UPDATE history ' +
                                '  SET ' +
                                '    otxid = NULL, ' +
                                '    oindex = NULL, ' +
                                '    ovalue = NULL, ' +
                                '    oscript = NULL ' +
                                '  WHERE ' +
                                '    oheight is NULL'
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
                   '    height IS NULL'
    },
    history: {
      fromHeight: 'DELETE FROM history ' +
                  '  WHERE ' +
                  '    iheight > $1 AND ' +
                  '    oheight > $1',

      unconfirmed: 'DELETE FROM history ' +
                   '  WHERE ' +
                   '    itxid IS NOT NULL AND ' +
                   '    otxid IS NOT NULL AND ' +
                   '    iheight IS NULL AND ' +
                   '    oheight IS NULL'
    }
  }
}
