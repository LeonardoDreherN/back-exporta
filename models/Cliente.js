const express = require('express')
const { Sequelize, DataTypes } = require('sequelize')
const sequelize = require('../config/db.js')

const app = express()

// Model Empresa
module.exports = (sequelize) => {

    return sequelize.define('Cliente', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      // 📌 Dados Gerais
      razaoSocial: { type: DataTypes.STRING, allowNull: false },
      nomeFantasia: { type: DataTypes.STRING, allowNull: false },
      cnpj: { type: DataTypes.STRING, allowNull: false, unique: true }, // único
      inscricaoEstadual: { type: DataTypes.STRING, allowNull: false },
      inscricaoMunicipal: { type: DataTypes.STRING }, // opcional
      cnaePrincipal: { type: DataTypes.STRING, allowNull: false },
      regimeTributario: { type: DataTypes.STRING, allowNull: false },
      dataFundacao: { type: DataTypes.DATE, allowNull: false },
    
      // 📌 Endereço da Empresa
      enderecoRua: { type: DataTypes.STRING, allowNull: false },
      enderecoNumero: { type: DataTypes.STRING, allowNull: false },
      enderecoComplemento: { type: DataTypes.STRING }, // opcional
      enderecoBairro: { type: DataTypes.STRING, allowNull: false },
      enderecoCidade: { type: DataTypes.STRING, allowNull: false },
      enderecoEstado: { type: DataTypes.STRING, allowNull: false },
      enderecoCEP: { type: DataTypes.STRING, allowNull: false },
      enderecoPais: { type: DataTypes.STRING, allowNull: false },
    
      // 📌 Contato
      responsavelNome: { type: DataTypes.STRING, allowNull: false },
      responsavelCargo: { type: DataTypes.STRING, allowNull: false },
      telefoneFixo: { type: DataTypes.STRING, allowNull: false },
      telefoneCelular: { type: DataTypes.STRING, allowNull: false },
      emailPrincipal: { type: DataTypes.STRING, allowNull: false, unique: true }, // único
      emailFiscal: { type: DataTypes.STRING, allowNull: false },
      emailLogistica: { type: DataTypes.STRING, allowNull: false },
    
      // 📌 Dados Fiscais
      certificadoDigitalTipo: { type: DataTypes.STRING, allowNull: false }, // A1 ou A3
      certificadoDigitalSenha: { type: DataTypes.STRING, allowNull: false },
      naturezaOperacaoPadrao: { type: DataTypes.STRING, allowNull: false }, // CFOP
      aliquotaICMS: { type: DataTypes.FLOAT, allowNull: false },
      aliquotaPIS: { type: DataTypes.FLOAT, allowNull: false },
      aliquotaCOFINS: { type: DataTypes.FLOAT, allowNull: false },
      aliquotaISS: { type: DataTypes.FLOAT, allowNull: false },
      informacoesComplementaresNFe: { type: DataTypes.TEXT, allowNull: false },
    
      // 📌 Dados Logísticos
      enderecoColeta: { type: DataTypes.STRING, allowNull: false },
      horariosColeta: { type: DataTypes.STRING, allowNull: false },
      dimensoesMedias: { type: DataTypes.STRING, allowNull: false },
      pesoMedio: { type: DataTypes.FLOAT, allowNull: false },
      tiposProdutos: { type: DataTypes.STRING, allowNull: false },
      observacoesLogisticas: { type: DataTypes.TEXT, allowNull: false },
    
      // 📌 Integrações com Transportadoras
      transportadoras: { type: DataTypes.STRING, allowNull: false },
      codigoClienteTransportadora: { type: DataTypes.STRING, allowNull: false },
      numeroContratoTransportadora: { type: DataTypes.STRING, allowNull: false },
      chaveAcessoTransportadora: { type: DataTypes.STRING, allowNull: false },
    
      // 📌 Dados Bancários
      banco: { type: DataTypes.STRING, allowNull: false },
      agencia: { type: DataTypes.STRING, allowNull: false },
      conta: { type: DataTypes.STRING, allowNull: false, unique: true }, // único
      tipoConta: { type: DataTypes.STRING, allowNull: false },
      chavePix: { type: DataTypes.STRING, allowNull: false }
    });
}
