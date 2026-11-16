'use strict';

/** Atualiza manualmente o regime de importacao Brasil -> Mexico. */
module.exports = {
  async up(queryInterface) {
    const [regimes] = await queryInterface.sequelize.query(`
      SELECT id
      FROM regimes_importacao
      WHERE pais_destino = 'MX' AND pais_origem = 'BR'
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `);

    if (!regimes.length) {
      throw new Error('Nenhum regime Brasil -> Mexico encontrado para atualizar.');
    }

    const agora = new Date();

    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.bulkUpdate(
        'regimes_importacao',
        {
          medidas: [
            {
              base: 'valor em aduana',
              tipo: 'imposto_importacao',
              medida: 'IGI conforme a classificacao tarifaria (TIGIE/HS Code)',
              aplica_a: 'importacoes',
              aliquota_pct: -1,
              em_vigor_desde: 'vigente',
              fonte_primaria: 'Confirmado',
            },
          ],
          imposto_consumo: {
            base: 'valor em aduana + IGI',
            nome: 'IVA',
            tipo: 'imposto_consumo',
            medida: 'IVA',
            incide_na_importacao: true,
            aplica_a: 'importacoes tributadas',
            aliquota_pct: 16,
            em_vigor_desde: 'vigente',
            fonte_primaria: 'Confirmado',
          },
          resumo: 'Brasil -> Mexico: IGI conforme a classificacao tarifaria (TIGIE/HS Code) e IVA de 16% sobre valor em aduana + IGI.',
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
    throw new Error('A atualizacao do regime Brasil -> Mexico nao possui rollback automatico.');
  },
};
