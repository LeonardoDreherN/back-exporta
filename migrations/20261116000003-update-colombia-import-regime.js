'use strict';

/** Atualiza manualmente o regime de importacao Brasil -> Colombia. */
module.exports = {
  async up(queryInterface) {
    const [regimes] = await queryInterface.sequelize.query(`
      SELECT id
      FROM regimes_importacao
      WHERE pais_destino = 'CO' AND pais_origem = 'BR'
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `);

    if (!regimes.length) {
      throw new Error('Nenhum regime Brasil -> Colombia encontrado para atualizar.');
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
              medida: 'Direito de importacao conforme HS Code e regime aduaneiro aplicavel',
              aplica_a: 'importacoes',
              aliquota_pct: -1,
              em_vigor_desde: 'vigente',
              fonte_primaria: 'Confirmado',
            },
          ],
          imposto_consumo: {
            base: 'valor aduaneiro + direito de importacao',
            nome: 'IVA',
            tipo: 'imposto_consumo',
            medida: 'IVA',
            incide_na_importacao: true,
            aplica_a: 'importacoes tributadas',
            aliquota_pct: 19,
            em_vigor_desde: 'vigente',
            fonte_primaria: 'Confirmado',
          },
          resumo: 'Brasil -> Colombia: direito de importacao conforme HS Code e regime aduaneiro aplicavel; IVA de 19% sobre valor aduaneiro + direito de importacao.',
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
    throw new Error('A atualizacao do regime Brasil -> Colombia nao possui rollback automatico.');
  },
};
