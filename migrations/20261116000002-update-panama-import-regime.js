'use strict';

/** Atualiza manualmente o regime de importacao Brasil -> Panama. */
module.exports = {
  async up(queryInterface) {
    const [regimes] = await queryInterface.sequelize.query(`
      SELECT id
      FROM regimes_importacao
      WHERE pais_destino = 'PA' AND pais_origem = 'BR'
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `);

    if (!regimes.length) {
      throw new Error('Nenhum regime Brasil -> Panama encontrado para atualizar.');
    }

    const agora = new Date();

    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.bulkUpdate(
        'regimes_importacao',
        {
          medidas: [
            {
              base: 'valor aduaneiro',
              tipo: 'imposto_importacao',
              medida: 'Isencao para remessas courier ate B/.100 (aprox. USD 100), desde que a mercadoria nao seja restrita',
              aplica_a: 'remessas ate B/.100',
              aplica_ate: 100,
              moeda_limite: 'USD',
              aliquota_pct: 0,
              em_vigor_desde: '2025-06-12',
              fonte_primaria: 'Confirmado',
            },
            {
              base: 'valor aduaneiro',
              tipo: 'imposto_importacao',
              medida: 'Direito aduaneiro conforme HS Code',
              aplica_a: 'remessas acima de B/.100',
              aplica_acima_de: 100,
              moeda_limite: 'USD',
              aliquota_pct: -1,
              em_vigor_desde: 'vigente',
              fonte_primaria: 'Confirmado',
            },
          ],
          imposto_consumo: {
            base: 'valor aduaneiro + direito de importacao',
            nome: 'ITBMS',
            tipo: 'imposto_consumo',
            medida: 'ITBMS',
            incide_na_importacao: true,
            aplica_a: 'importacoes tributadas',
            aliquota_pct: 7,
            em_vigor_desde: 'vigente',
            fonte_primaria: 'Confirmado',
          },
          resumo: 'Brasil -> Panama: isencao de direito para remessas courier ate B/.100 e direito conforme HS Code acima desse limite; ITBMS de 7% nas importacoes tributadas.',
          status: 'aprovado',
          aprovado_por: 'atualizacao_manual',
          aprovado_em: agora,
          valido_ate: null,
          updated_at: agora,
        },
        { id: regimes[0].id },
        { transaction },
      );
    });
  },

  async down() {
    throw new Error('A atualizacao do regime Brasil -> Panama nao possui rollback automatico.');
  },
};
