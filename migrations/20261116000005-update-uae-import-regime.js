'use strict';

/** Atualiza manualmente o regime de importacao Brasil -> Emirados Arabes Unidos. */
module.exports = {
  async up(queryInterface) {
    const [regimes] = await queryInterface.sequelize.query(`
      SELECT id
      FROM regimes_importacao
      WHERE pais_destino = 'AE' AND pais_origem = 'BR'
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `);

    if (!regimes.length) {
      throw new Error('Nenhum regime Brasil -> Emirados Arabes Unidos encontrado para atualizar.');
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
              medida: 'Direito aduaneiro geral conforme classificacao tarifaria',
              aplica_a: 'importacoes',
              aliquota_pct: 5,
              excecoes: 'Produtos com tarifas especificas ou medidas comerciais especiais',
              em_vigor_desde: 'vigente',
              fonte_primaria: 'Confirmado',
            },
          ],
          imposto_consumo: {
            base: 'valor CIF + direito aduaneiro',
            nome: 'VAT',
            tipo: 'imposto_consumo',
            medida: 'VAT',
            incide_na_importacao: true,
            aplica_a: 'importacoes tributadas',
            aliquota_pct: 5,
            em_vigor_desde: 'vigente',
            fonte_primaria: 'Confirmado',
          },
          resumo: 'Brasil -> Emirados Arabes Unidos (Dubai): direito aduaneiro geral de 5% e VAT de 5% sobre valor CIF + direito aduaneiro, sujeitos a excecoes tarifarias.',
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
    throw new Error('A atualizacao do regime Brasil -> Emirados Arabes Unidos nao possui rollback automatico.');
  },
};
