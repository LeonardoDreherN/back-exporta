const { Sequelize } = require('sequelize');
const ClienteModel = require('./Cliente.js');
const CaixaModel = require('./Caixas.js');
const ProdutoModel = require('./Produtos.js');
const ShopModel = require('./Shop.js');
const InfoShopifyModel = require('./InfoShopify.js');
const CotacaoModel = require('./Cotacao.js');
const PedidoImportModel = require('./PedidoImport.js');
const ShipmentModel = require('./Shipment.js');
const AsaasBoletosModel = require('./AsaasBoletos.js');
const WorldeaseMasterModel = require('./WorldeaseMaster.js');
const InfoNuvemshopModel = require('./InfoNuvemshop.js');
const NuvemshopShopModel = require('./NuvemshopShop.js');
const AdminUserModel = require('./AdminUser.js');
const AdminAuditLogModel = require('./AdminAuditLog.js');
const SyncLogModel = require('./SyncLog.js');
const IntegrationStatusModel = require('./IntegrationStatus.js');
const StatusIncidentModel = require('./StatusIncident.js');
const AnnouncementModel = require('./Announcement.js');
const ChangelogEntryModel = require('./ChangelogEntry.js');
const RoadmapCardModel = require('./RoadmapCard.js');

require('dotenv/config');

const sequelize = new Sequelize(
  process.env.SUPABASE_DB_URL,
  {
    dialect: 'postgres',
    logging: false,
    pool: { min: 0, max: 5, idle: 10000, acquire: 30000 },
    port: Number(process.env.DB_PORT) || 5432,
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false,
      },
    },
  }
);

const db = {
  Sequelize,
  sequelize,
  Cliente: ClienteModel(sequelize),
  Caixa: CaixaModel(sequelize),
  Produto: ProdutoModel(sequelize),
  Shop: ShopModel(sequelize),
  InfoShopify: InfoShopifyModel(sequelize),
  Cotacao: CotacaoModel(sequelize),
  PedidoImport: PedidoImportModel(sequelize),
  AsaasBoletos: AsaasBoletosModel(sequelize),
  Shipment: ShipmentModel(sequelize),
  WorldeaseMaster: WorldeaseMasterModel(sequelize),
  InfoNuvemshop: InfoNuvemshopModel(sequelize),
  NuvemshopShop: NuvemshopShopModel(sequelize),
  AdminUser: AdminUserModel(sequelize),
  AdminAuditLog: AdminAuditLogModel(sequelize),
  SyncLog: SyncLogModel(sequelize),
  IntegrationStatus: IntegrationStatusModel(sequelize),
  StatusIncident: StatusIncidentModel(sequelize),
  Announcement: AnnouncementModel(sequelize),
  ChangelogEntry: ChangelogEntryModel(sequelize),
  RoadmapCard: RoadmapCardModel(sequelize),
};

// Ativa apenas as associações necessárias para o admin (Cotacao já definia a sua,
// mas nunca era chamada). Não fazemos um loop global porque alguns models legados
// (ex.: Produto/Caixa) têm associações duplicadas entre si que colidem se ambas
// forem ativadas ao mesmo tempo — preferimos não mexer nesse comportamento existente.
const modelsWithAssociate = [
  'Cotacao',
  'AdminAuditLog',
  'SyncLog',
  'IntegrationStatus',
  'StatusIncident',
  'Announcement',
  'ChangelogEntry',
  'RoadmapCard',
];

modelsWithAssociate.forEach((name) => {
  if (db[name] && typeof db[name].associate === 'function') {
    db[name].associate(db);
  }
});

module.exports = db;