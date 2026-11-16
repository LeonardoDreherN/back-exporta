'use strict';

/**
 * Atualiza manualmente o regime de importacao Brasil -> Egito.
 *
 * O modelo separa o direito aduaneiro (medidas) do imposto sobre consumo.
 * O VAT recebido na mesma lista e persistido no campo proprio para que o
 * calculo direto aplique a base CIF + direito aduaneiro corretamente.
 */
module.exports = {
  async up(queryInterface) {
    const [regimes] = await queryInterface.sequelize.query(`
      SELECT id
      FROM regimes_importacao
      WHERE pais_destino = 'EG' AND pais_origem = 'BR'
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `);

    if (!regimes.length) {
      throw new Error('Nenhum regime Brasil -> Egito encontrado para atualizar.');
    }

    const agora = new Date();

    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.bulkUpdate(
        'regimes_importacao',
        {
          medidas: [
            {
              base: 'valor CIF',
              tipo: 'imposto_importacao',
              medida: 'Direito aduaneiro conforme HS Code',
              aplica_a: 'todas as importacoes',
              aliquota_pct: -1,
              fonte_primaria: 'Confirmado',
            },
          ],
          imposto_consumo: {
            base: 'valor CIF + direito aduaneiro',
            nome: 'VAT',
            tipo: 'VAT',
            medida: 'VAT',
            incide_na_importacao: true,
            aplica_a: 'todas as importacoes',
            aliquota_pct: 14,
            fonte_primaria: 'Confirmado',
          },
          resumo: 'Brasil -> Egito: direito aduaneiro conforme HS Code e VAT de 14% sobre valor CIF + direito aduaneiro.',
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
    throw new Error('A atualizacao do regime Brasil -> Egito nao possui rollback automatico.');
  },
};
