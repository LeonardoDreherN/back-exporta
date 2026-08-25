const { DataTypes } = require('sequelize')

// Model Empresa
module.exports = (sequelize) => {

  return sequelize.define('Cliente', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    emailPrincipal: { type: DataTypes.STRING, allowNull: false, unique: true }, // único
    senha: { type: DataTypes.STRING, allowNull: false },
    tipoConta: { type: DataTypes.ENUM('parceiro', 'empresa'), allowNull: false }, // 'pessoa_fisica' ou 'pessoa_juridica'
    emailAssociado: { type: DataTypes.STRING, allowNull: true },
    codigo: { type: DataTypes.STRING, allowNull: false, unique: true }, // único
    razaoSocial: { type: DataTypes.STRING, allowNull: false },
    enderecoPais: { type: DataTypes.STRING, allowNull: false },
    enderecoCEP: { type: DataTypes.STRING, allowNull: false },
    enderecoRua: { type: DataTypes.STRING, allowNull: false },
    enderecoNumero: { type: DataTypes.STRING, allowNull: false },
    enderecoComplemento: { type: DataTypes.STRING }, // opcional
    enderecoCidade: { type: DataTypes.STRING, allowNull: false },
    enderecoEstado: { type: DataTypes.STRING, allowNull: false },
    cnpj: { type: DataTypes.STRING, allowNull: false, unique: true }, // único (CNPJ, CPF ou nº de registro estrangeiro, conforme tipoDocumento)
    tipoDocumento: {
      type: DataTypes.ENUM('cnpj', 'cpf', 'estrangeiro'),
      allowNull: false,
      defaultValue: 'cnpj',
    },
    cnaePrincipal: { type: DataTypes.STRING, allowNull: true },
    telefoneCelular: { type: DataTypes.STRING, allowNull: false },
    plano: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'basico',
      validate: {
        isIn: [['basico', 'gold', 'premium', 'minimo', 'vinte']]
      }
    },
    descIOR: { type: DataTypes.STRING, allowNull: true },
    nomeIOR: { type: DataTypes.STRING, allowNull: true },
    emailIOR: { type: DataTypes.STRING, allowNull: true },
    tipoIOR: { type: DataTypes.STRING, allowNull: true },
    paisIOR: { type: DataTypes.STRING, allowNull: true },
    cod_postalIOR: { type: DataTypes.STRING, allowNull: true },
    estadoIOR: { type: DataTypes.STRING, allowNull: true },
    cidadeIOR: { type: DataTypes.STRING, allowNull: true },
    enderecoIOR: { type: DataTypes.STRING, allowNull: true },
    numeroIOR: { type: DataTypes.STRING, allowNull: true },
    telefoneIOR: { type: DataTypes.STRING, allowNull: true },
    state_tax_idIOR: { type: DataTypes.STRING, allowNull: true },
    ups_shipper_number: { type: DataTypes.STRING, allowNull: true },
    ups_client_id: { type: DataTypes.STRING, allowNull: true },
    ups_client_secret: { type: DataTypes.STRING, allowNull: true },
    customerAsaas: { type: DataTypes.STRING, allowNull: true }, // id do customer no Asaas

    status: {
      type: DataTypes.ENUM('ativo', 'inativo', 'suspenso'),
      allowNull: false,
      defaultValue: 'ativo',
    },
    lastLoginAt: { type: DataTypes.DATE, allowNull: true },

    // Se true (padrão), o endereço da empresa (enderecoPais/Rua/etc.) é usado
    // para pré-preencher o remetente nas cotações e coletas. Clientes que
    // coletam em endereços variados podem desativar para digitar manualmente
    // a cada solicitação.
    remetenteFixoAtivo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },

    // ===== ENDEREÇO FIXO DE DESTINATÁRIO =====
    // Preenche automaticamente o destinatário nas cotações (editável), para
    // clientes que sempre enviam para o mesmo destino no exterior.
    destinoFixoNome: { type: DataTypes.STRING, allowNull: true },
    destinoFixoPais: { type: DataTypes.STRING, allowNull: true },
    destinoFixoEstado: { type: DataTypes.STRING, allowNull: true },
    destinoFixoCidade: { type: DataTypes.STRING, allowNull: true },
    destinoFixoRua: { type: DataTypes.STRING, allowNull: true },
    destinoFixoCEP: { type: DataTypes.STRING, allowNull: true },
    destinoFixoTelefone: { type: DataTypes.STRING, allowNull: true },

    // Chave usada por plataformas externas (ex.: e-commerce próprio de um
    // parceiro em PHP) para autenticar nas rotas públicas de cotação e
    // criação de pedido (/api/public-quote e /api/public-orders).
    publicApiKey: { type: DataTypes.STRING, allowNull: true, unique: true },
  });
}
