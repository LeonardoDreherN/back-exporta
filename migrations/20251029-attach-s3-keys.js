// "use strict";

// /**
//  * Exemplo adicionando campos para guardar chaves S3 e metadados,
//  * mantendo invoice_base64/etiqueta_base64 existentes.
//  */
// module.exports = {
//     async up(queryInterface, Sequelize) {
//         await queryInterface.addColumn("cotacoes", "invoice_s3_key", {
//             type: Sequelize.STRING(512),
//             allowNull: true,
//             after: "invoice_base64",
//         });
//         await queryInterface.addColumn("cotacoes", "invoice_mime", {
//             type: Sequelize.STRING(100),
//             allowNull: true,
//             after: "invoice_s3_key",
//         });
//         await queryInterface.addColumn("cotacoes", "invoice_size", {
//             type: Sequelize.INTEGER,
//             allowNull: true,
//             after: "invoice_mime",
//         });
//         await queryInterface.addColumn("cotacoes", "invoice_sha256", {
//             type: Sequelize.STRING(64),
//             allowNull: true,
//             after: "invoice_size",
//         });

//         await queryInterface.addColumn("cotacoes", "label_s3_key", {
//             type: Sequelize.STRING(512),
//             allowNull: true,
//             after: "etiqueta_base64",
//         });
//         await queryInterface.addColumn("cotacoes", "label_mime", {
//             type: Sequelize.STRING(100),
//             allowNull: true,
//             after: "label_s3_key",
//         });
//         await queryInterface.addColumn("cotacoes", "label_size", {
//             type: Sequelize.INTEGER,
//             allowNull: true,
//             after: "label_mime",
//         });
//         await queryInterface.addColumn("cotacoes", "label_sha256", {
//             type: Sequelize.STRING(64),
//             allowNull: true,
//             after: "label_size",
//         });

//         await queryInterface.addIndex("cotacoes", ["invoice_s3_key"]);
//         await queryInterface.addIndex("cotacoes", ["label_s3_key"]);
//     },

//     async down(queryInterface) {
//         await queryInterface.removeIndex("cotacoes", ["invoice_s3_key"]);
//         await queryInterface.removeIndex("cotacoes", ["label_s3_key"]);

//         await queryInterface.removeColumn("cotacoes", "invoice_s3_key");
//         await queryInterface.removeColumn("cotacoes", "invoice_mime");
//         await queryInterface.removeColumn("cotacoes", "invoice_size");
//         await queryInterface.removeColumn("cotacoes", "invoice_sha256");

//         await queryInterface.removeColumn("cotacoes", "label_s3_key");
//         await queryInterface.removeColumn("cotacoes", "label_mime");
//         await queryInterface.removeColumn("cotacoes", "label_size");
//         await queryInterface.removeColumn("cotacoes", "label_sha256");
//     },
// };
