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
    cnpj: { type: DataTypes.STRING, allowNull: false, unique: true }, // único
    cnaePrincipal: { type: DataTypes.STRING, allowNull: true },
    telefoneCelular: { type: DataTypes.STRING, allowNull: false },
    plano: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'basico',
      validate: {
        isIn: [['basico', 'gold', 'premium']]
      }
    },
    descIOR: { type: DataTypes.STRING, allowNull: false },
    nomeIOR: { type: DataTypes.STRING, allowNull: false },
    emailIOR: { type: DataTypes.STRING, allowNull: false },
    tipoIOR: { type: DataTypes.STRING, allowNull: false },
    paisIOR: { type: DataTypes.STRING, allowNull: false },
    cod_postalIOR: { type: DataTypes.STRING, allowNull: false },
    estadoIOR: { type: DataTypes.STRING, allowNull: false },
    cidadeIOR: { type: DataTypes.STRING, allowNull: false },
    enderecoIOR: { type: DataTypes.STRING, allowNull: false },
    numeroIOR: { type: DataTypes.STRING, allowNull: false },
    telefoneIOR: { type: DataTypes.STRING, allowNull: false },
    state_tax_idIOR: { type: DataTypes.STRING, allowNull: false },
    customerAsaas: { type: DataTypes.STRING, allowNull: true }, // id do customer no Asaas
  });
}
