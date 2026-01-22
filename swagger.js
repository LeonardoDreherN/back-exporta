const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Intrex API',
            version: '1.0.0',
            description: 'OpenAPI spec generated from the current Express routes.',
        },
        servers: [
            {
                url: process.env.SWAGGER_BASE_URL || 'http://localhost:3001',
            },
        ],
        tags: [
            { name: 'Health' },
            { name: 'Auth' },
            { name: 'Clientes' },
            { name: 'Caixas' },
            // { name: 'Produtos' },
            // { name: 'Shopify' },
            { name: 'Pedidos' },
            { name: 'Cotacoes' },
            { name: 'Shipments' },
            { name: 'UPS' },
            { name: 'FedEx' },
            { name: 'Relatorios' },
            { name: 'Uploads' },
            { name: 'SSE' },
            { name: 'Asaas' },
            { name: 'Debug' },
            { name: 'Misc' },
            { name: 'Dashboard' }
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                },
                cookieAuth: {
                    type: 'apiKey',
                    in: 'cookie',
                    name: 'access_token',
                },
            },
            schemas: {
                Error: {
                    type: 'object',
                    properties: {
                        error: { type: 'string' },
                        erro: { type: 'string' },
                        details: { type: 'string' },
                    },
                },
                LoginRequest: {
                    type: 'object',
                    required: ['emailPrincipal', 'senha'],
                    properties: {
                        emailPrincipal: { type: 'string', format: 'email' },
                        senha: { type: 'string', format: 'password' },
                    },
                },
                RegistrarClienteRequest: {
                    type: 'object',
                    required: [
                        'emailPrincipal',
                        'senha',
                        'tipoConta',
                        'razaoSocial',
                        'enderecoPais',
                        'enderecoCEP',
                        'enderecoRua',
                        'enderecoNumero',
                        'enderecoCidade',
                        'enderecoEstado',
                        'cnpj',
                        'telefoneCelular',
                        'plano',
                        'descIOR',
                        'nomeIOR',
                        'emailIOR',
                        'tipoIOR',
                        'paisIOR',
                        'cod_postalIOR',
                        'estadoIOR',
                        'cidadeIOR',
                        'enderecoIOR',
                        'numeroIOR',
                        'telefoneIOR',
                        'state_tax_idIOR',
                    ],
                    properties: {
                        emailPrincipal: { type: 'string', format: 'email' },
                        senha: { type: 'string', format: 'password' },
                        tipoConta: { type: 'string', enum: ['empresa', 'parceiro'] },
                        razaoSocial: { type: 'string' },
                        emailAssociado: { type: 'string', format: 'email', nullable: true },
                        codigo: { type: 'string', nullable: true },
                        enderecoPais: { type: 'string' },
                        enderecoCEP: { type: 'string' },
                        enderecoRua: { type: 'string' },
                        enderecoNumero: { type: 'string' },
                        enderecoComplemento: { type: 'string', nullable: true },
                        enderecoCidade: { type: 'string' },
                        enderecoEstado: { type: 'string' },
                        cnpj: { type: 'string' },
                        cnaePrincipal: { type: 'string', nullable: true },
                        telefoneCelular: { type: 'string' },
                        plano: { type: 'string' },
                        descIOR: { type: 'string' },
                        nomeIOR: { type: 'string' },
                        emailIOR: { type: 'string', format: 'email' },
                        tipoIOR: { type: 'string' },
                        paisIOR: { type: 'string' },
                        cod_postalIOR: { type: 'string' },
                        estadoIOR: { type: 'string' },
                        cidadeIOR: { type: 'string' },
                        enderecoIOR: { type: 'string' },
                        numeroIOR: { type: 'string' },
                        telefoneIOR: { type: 'string' },
                        state_tax_idIOR: { type: 'string' },
                    },
                },
                CaixaRequest: {
                    type: 'object',
                    required: ['cod_identificacao', 'descricao', 'altura', 'largura', 'comprimento', 'peso'],
                    properties: {
                        cod_identificacao: { type: 'string' },
                        descricao: { type: 'string' },
                        altura: { type: 'number' },
                        largura: { type: 'number' },
                        comprimento: { type: 'number' },
                        peso: { type: 'number' },
                    },
                },
                ProdutoRequest: {
                    type: 'object',
                    required: [
                        'sku',
                        'nome',
                        'descricao',
                        'pais_origem',
                        'categoria',
                        'hscode',
                        'altura',
                        'largura',
                        'profundidade',
                        'peso',
                        'cod_identificacao',
                    ],
                    properties: {
                        sku: { type: 'string' },
                        nome: { type: 'string' },
                        descricao: { type: 'string' },
                        pais_origem: { type: 'string' },
                        categoria: { type: 'string' },
                        hscode: { type: 'string' },
                        altura: { type: 'number' },
                        largura: { type: 'number' },
                        profundidade: { type: 'number' },
                        peso: { type: 'number' },
                        cod_identificacao: { type: 'string' },
                    },
                },
                UPSAddress: {
                    type: 'object',
                    properties: {
                        nome: { type: 'string' },
                        name: { type: 'string' },
                        empresa: { type: 'string' },
                        telefone: { type: 'string' },
                        phone: { type: 'string' },
                        email: { type: 'string' },
                        rua: { type: 'string' },
                        street: { type: 'string' },
                        numero: { type: 'string' },
                        number: { type: 'string' },
                        complemento: { type: 'string' },
                        cidade: { type: 'string' },
                        city: { type: 'string' },
                        estado: { type: 'string' },
                        state: { type: 'string' },
                        cep: { type: 'string' },
                        postalCode: { type: 'string' },
                        pais: { type: 'string' },
                        country: { type: 'string' },
                        addressLine: { type: 'string' },
                    },
                },
                UPSPackage: {
                    type: 'object',
                    properties: {
                        reference: { type: 'string' },
                        weightKg: { type: 'number' },
                        dimCm: {
                            type: 'object',
                            properties: {
                                length: { type: 'number' },
                                width: { type: 'number' },
                                height: { type: 'number' },
                            },
                        },
                    },
                },
                UPSPayment: {
                    type: 'object',
                    required: ['bill'],
                    properties: {
                        bill: { type: 'string', enum: ['Shipper', 'Receiver', 'ThirdParty'] },
                        account: { type: 'string' },
                    },
                },
                UPSInvoiceItem: {
                    type: 'object',
                    properties: {
                        description: { type: 'string' },
                        hscode: { type: 'string' },
                        countryOfOrigin: { type: 'string' },
                        quantity: { type: 'number' },
                        unitPrice: { type: 'number' },
                    },
                },
                UPSInvoice: {
                    type: 'object',
                    properties: {
                        date: { type: 'string', format: 'date' },
                        number: { type: 'string' },
                        currency: { type: 'string' },
                        items: { type: 'array', items: { $ref: '#/components/schemas/UPSInvoiceItem' } },
                    },
                },
                UPSRateBusinessRequest: {
                    type: 'object',
                    required: ['shipper', 'shipTo', 'serviceCode', 'packages'],
                    properties: {
                        shipper: { $ref: '#/components/schemas/UPSAddress' },
                        shipTo: { $ref: '#/components/schemas/UPSAddress' },
                        serviceCode: { type: 'string', description: 'UPS service code (ex: 08)' },
                        packages: { type: 'array', items: { $ref: '#/components/schemas/UPSPackage' } },
                    },
                },
                UPSShipmentRequest: {
                    type: 'object',
                    properties: {
                        ShipmentRequest: {
                            type: 'object',
                            properties: {
                                Shipment: {
                                    type: 'object',
                                    properties: {
                                        Shipper: { type: 'object' },
                                        ShipFrom: { type: 'object' },
                                        ShipTo: { type: 'object' },
                                        Service: { type: 'object' },
                                        Package: { type: 'array', items: { type: 'object' } },
                                        ShipmentServiceOptions: { type: 'object' },
                                    },
                                },
                            },
                        },
                    },
                },
                UPSRateRequest: {
                    description: 'Accepts RateRequest, ShipmentRequest (UPS format), or business payload.',
                    oneOf: [
                        { $ref: '#/components/schemas/UPSRateBusinessRequest' },
                        { $ref: '#/components/schemas/UPSShipmentRequest' },
                        { type: 'object', properties: { RateRequest: { type: 'object' } } },
                    ],
                },
                UPSShipBusinessRequest: {
                    type: 'object',
                    required: ['shipper', 'shipTo', 'serviceCode', 'payment', 'packages'],
                    properties: {
                        shipper: { $ref: '#/components/schemas/UPSAddress' },
                        shipFrom: { $ref: '#/components/schemas/UPSAddress' },
                        shipTo: { $ref: '#/components/schemas/UPSAddress' },
                        serviceCode: { type: 'string' },
                        payment: { $ref: '#/components/schemas/UPSPayment' },
                        packages: { type: 'array', items: { $ref: '#/components/schemas/UPSPackage' } },
                        invoice: { $ref: '#/components/schemas/UPSInvoice' },
                        triangulacao: { type: 'string', description: 'Terms of shipment (ex: DAP)' },
                        cotacaoId: { type: 'integer' },
                    },
                },
                UPSShipRequest: {
                    description: 'Accepts ShipmentRequest (UPS format) or business payload.',
                    oneOf: [
                        { $ref: '#/components/schemas/UPSShipBusinessRequest' },
                        { $ref: '#/components/schemas/UPSShipmentRequest' },
                    ],
                },
                FedexPartyOverride: {
                    type: 'object',
                    properties: {
                        nome: { type: 'string' },
                        name: { type: 'string' },
                        empresa: { type: 'string' },
                        telefone: { type: 'string' },
                        phone: { type: 'string' },
                        email: { type: 'string' },
                        rua: { type: 'string' },
                        numero: { type: 'string' },
                        complemento: { type: 'string' },
                        cidade: { type: 'string' },
                        estado: { type: 'string' },
                        cep: { type: 'string' },
                        pais: { type: 'string' },
                        residential: { type: 'boolean' },
                        cnpjOuTaxId: { type: 'string' },
                    },
                },
                FedexRateRequest: {
                    type: 'object',
                    required: ['pedido_ref', 'packagesId', 'pesoTotalPedidoKg'],
                    properties: {
                        pedido_ref: { type: 'string' },
                        packagesId: {
                            oneOf: [
                                { type: 'integer' },
                                { type: 'array', items: { type: 'integer' } },
                            ],
                        },
                        pesoTotalPedidoKg: { type: 'number' },
                        shipper: { $ref: '#/components/schemas/FedexPartyOverride' },
                        remetente: { $ref: '#/components/schemas/FedexPartyOverride' },
                        recipient: { $ref: '#/components/schemas/FedexPartyOverride' },
                        destinatario: { $ref: '#/components/schemas/FedexPartyOverride' },
                    },
                },
                FedexShipRequest: {
                    type: 'object',
                    required: ['pedido_ref', 'packagesId', 'pesoTotalPedidoKg'],
                    properties: {
                        pedido_ref: { type: 'string' },
                        packagesId: {
                            oneOf: [
                                { type: 'integer' },
                                { type: 'array', items: { type: 'integer' } },
                            ],
                        },
                        pesoTotalPedidoKg: { type: 'number' },
                        rate_payload: { type: 'object' },
                        freight_total: { type: 'number' },
                        frete_total: { type: 'number' },
                        shipper: { $ref: '#/components/schemas/FedexPartyOverride' },
                        remetente: { $ref: '#/components/schemas/FedexPartyOverride' },
                        recipient: { $ref: '#/components/schemas/FedexPartyOverride' },
                        destinatario: { $ref: '#/components/schemas/FedexPartyOverride' },
                    },
                },
                FedexPickupRequest: {
                    type: 'object',
                    description: 'Pass-through payload for FedEx Pickup API.',
                },
                CotacaoCreateRequest: {
                    type: 'object',
                    required: ['pedido_ref', 'carrier'],
                    properties: {
                        pedido_ref: { type: 'string' },
                        pais_remetente: { type: 'string' },
                        pais_dest: { type: 'string' },
                        pedido: { type: 'object' },
                        caixa: { type: 'object' },
                        tracking_number: { type: 'string' },
                        carrier: { type: 'string', enum: ['UPS', 'FEDEX'] },
                        rate_payload: { type: 'object' },
                        preco_base: { type: 'number' },
                        freightValueNum: { type: 'number' },
                        serviceCode: { type: 'string' },
                    },
                },
                CotacaoAttachDocsRequest: {
                    type: 'object',
                    properties: {
                        etiqueta_base64: { type: 'string' },
                        etiqueta_mime: { type: 'string' },
                        invoice_base64: { type: 'string' },
                        invoice_mime: { type: 'string' },
                        etiqueta_url: { type: 'string' },
                        invoice_url: { type: 'string' },
                        tracking_number: { type: 'string' },
                        carrier: { type: 'string' },
                    },
                },
                CotacaoPickupRequest: {
                    type: 'object',
                    required: ['pickupDate'],
                    properties: {
                        pickupDate: { type: 'string', format: 'date' },
                        readyTime: { type: 'string', description: 'HHmm or HH:mm' },
                        closeTime: { type: 'string', description: 'HHmm or HH:mm' },
                        serviceCode: { type: 'string' },
                        cotacaoId: { type: 'integer' },
                    },
                },
            },
        },
        paths: {
            '/health': {
                get: {
                    tags: ['Health'],
                    summary: 'Health check',
                    responses: {
                        200: { description: 'OK' },
                    },
                },
            },
            '/healthz': {
                get: {
                    tags: ['Health'],
                    summary: 'Health check JSON',
                    responses: {
                        200: { description: 'OK' },
                    },
                },
            },
            '/registrarClientes': {
                post: {
                    tags: ['Clientes'],
                    summary: 'Registrar cliente',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/RegistrarClienteRequest' },
                            },
                        },
                    },
                    responses: {
                        201: { description: 'Created' },
                        400: { description: 'Bad Request', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
                        409: { description: 'Conflict' },
                        500: { description: 'Server Error' },
                    },
                },
            },
            '/login': {
                post: {
                    tags: ['Auth'],
                    summary: 'Login do cliente',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/LoginRequest' },
                            },
                        },
                    },
                    responses: {
                        200: { description: 'OK' },
                        401: { description: 'Unauthorized' },
                        500: { description: 'Server Error' },
                    },
                },
            },
            '/auth/refresh': {
                post: {
                    tags: ['Auth'],
                    summary: 'Refresh access token',
                    responses: {
                        200: { description: 'OK' },
                        401: { description: 'Unauthorized' },
                    },
                },
            },
            '/auth/logout': {
                post: {
                    tags: ['Auth'],
                    summary: 'Logout',
                    responses: {
                        200: { description: 'OK' },
                    },
                },
            },
            '/verClientes': {
                get: {
                    tags: ['Clientes'],
                    summary: 'Listar clientes',
                    responses: {
                        200: { description: 'OK' },
                    },
                },
            },
            '/verClienteAtual': {
                get: {
                    tags: ['Clientes'],
                    summary: 'Cliente autenticado',
                    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
                    responses: {
                        200: { description: 'OK' },
                        401: { description: 'Unauthorized' },
                    },
                },
            },
            '/me': {
                get: {
                    tags: ['Auth'],
                    summary: 'Info do usuario autenticado',
                    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
                    responses: {
                        200: { description: 'OK' },
                        401: { description: 'Unauthorized' },
                    },
                },
            },
            '/validate/cnpj': {
                get: {
                    tags: ['Misc'],
                    summary: 'Validar CNPJ',
                    parameters: [
                        { name: 'cnpj', in: 'query', required: true, schema: { type: 'string' } },
                        { name: 'online', in: 'query', required: false, schema: { type: 'string' } },
                    ],
                    responses: {
                        200: { description: 'OK' },
                        500: { description: 'Server Error' },
                    },
                },
            },
            '/validate/cnae': {
                get: {
                    tags: ['Misc'],
                    summary: 'Validar CNAE',
                    parameters: [
                        { name: 'cnae', in: 'query', required: true, schema: { type: 'string' } },
                    ],
                    responses: {
                        200: { description: 'OK' },
                        500: { description: 'Server Error' },
                    },
                },
            },
            '/registrarCaixa': {
                post: {
                    tags: ['Caixas'],
                    summary: 'Registrar caixa',
                    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
                    parameters: [
                        { name: 'x-csrf-token', in: 'header', required: false, schema: { type: 'string' } },
                    ],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': { schema: { $ref: '#/components/schemas/CaixaRequest' } },
                        },
                    },
                    responses: {
                        201: { description: 'Created' },
                        401: { description: 'Unauthorized' },
                    },
                },
            },
            '/verCaixas': {
                get: {
                    tags: ['Caixas'],
                    summary: 'Listar caixas',
                    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
                    responses: {
                        200: { description: 'OK' },
                        401: { description: 'Unauthorized' },
                    },
                },
            },
            '/excluirCaixa/{id}': {
                delete: {
                    tags: ['Caixas'],
                    summary: 'Excluir caixa',
                    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
                    parameters: [
                        { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
                        { name: 'x-csrf-token', in: 'header', required: false, schema: { type: 'string' } },
                    ],
                    responses: {
                        200: { description: 'OK' },
                        404: { description: 'Not Found' },
                    },
                },
            },
            '/editarCaixa/{id}': {
                put: {
                    tags: ['Caixas'],
                    summary: 'Editar caixa',
                    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
                    parameters: [
                        { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
                        { name: 'x-csrf-token', in: 'header', required: false, schema: { type: 'string' } },
                    ],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': { schema: { $ref: '#/components/schemas/CaixaRequest' } },
                        },
                    },
                    responses: {
                        200: { description: 'OK' },
                    },
                },
            },
            // '/verProdutos': {
            //     get: {
            //         tags: ['Produtos'],
            //         summary: 'Listar produtos',
            //         security: [{ bearerAuth: [] }, { cookieAuth: [] }],
            //         responses: {
            //             200: { description: 'OK' },
            //         },
            //     },
            // },
            // '/registrarProduto': {
            //     post: {
            //         tags: ['Produtos'],
            //         summary: 'Registrar produto',
            //         security: [{ bearerAuth: [] }, { cookieAuth: [] }],
            //         parameters: [
            //             { name: 'x-csrf-token', in: 'header', required: false, schema: { type: 'string' } },
            //         ],
            //         requestBody: {
            //             required: true,
            //             content: {
            //                 'application/json': { schema: { $ref: '#/components/schemas/ProdutoRequest' } },
            //             },
            //         },
            //         responses: {
            //             201: { description: 'Created' },
            //         },
            //     },
            // },
            // '/excluirProduto/{id}': {
            //     delete: {
            //         tags: ['Produtos'],
            //         summary: 'Excluir produto',
            //         security: [{ bearerAuth: [] }, { cookieAuth: [] }],
            //         parameters: [
            //             { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
            //             { name: 'x-csrf-token', in: 'header', required: false, schema: { type: 'string' } },
            //         ],
            //         responses: {
            //             200: { description: 'OK' },
            //         },
            //     },
            // },
            // '/editarProduto/{id}': {
            //     put: {
            //         tags: ['Produtos'],
            //         summary: 'Editar produto',
            //         security: [{ bearerAuth: [] }, { cookieAuth: [] }],
            //         parameters: [
            //             { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
            //             { name: 'x-csrf-token', in: 'header', required: false, schema: { type: 'string' } },
            //         ],
            //         requestBody: {
            //             required: true,
            //             content: {
            //                 'application/json': { schema: { $ref: '#/components/schemas/ProdutoRequest' } },
            //             },
            //         },
            //         responses: {
            //             200: { description: 'OK' },
            //         },
            //     },
            // },
            // '/conectarLoja': {
            //     post: {
            //         tags: ['Shopify'],
            //         summary: 'Conectar loja Shopify',
            //         security: [{ bearerAuth: [] }, { cookieAuth: [] }],
            //         parameters: [
            //             { name: 'x-csrf-token', in: 'header', required: false, schema: { type: 'string' } },
            //         ],
            //         requestBody: {
            //             required: true,
            //             content: { 'application/json': { schema: { type: 'object' } } },
            //         },
            //         responses: {
            //             200: { description: 'OK' },
            //         },
            //     },
            // },
            // '/shopify/import-pedidos': {
            //     post: {
            //         tags: ['Shopify'],
            //         summary: 'Importar pedidos Shopify (CSV)',
            //         security: [{ bearerAuth: [] }, { cookieAuth: [] }],
            //         parameters: [
            //             { name: 'x-csrf-token', in: 'header', required: false, schema: { type: 'string' } },
            //         ],
            //         requestBody: {
            //             required: true,
            //             content: {
            //                 'multipart/form-data': {
            //                     schema: {
            //                         type: 'object',
            //                         properties: {
            //                             file: { type: 'string', format: 'binary' },
            //                             sku_master: { type: 'string', format: 'binary' },
            //                         },
            //                     },
            //                 },
            //             },
            //         },
            //         responses: {
            //             200: { description: 'OK' },
            //             400: { description: 'Bad Request' },
            //         },
            //     },
            // },
            '/pedidos': {
                get: {
                    tags: ['Pedidos'],
                    summary: 'Listar pedidos importados',
                    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
                    parameters: [
                        { name: 'q', in: 'query', required: false, schema: { type: 'string' } },
                        { name: 'limit', in: 'query', required: false, schema: { type: 'integer' } },
                        { name: 'offset', in: 'query', required: false, schema: { type: 'integer' } },
                    ],
                    responses: {
                        200: { description: 'OK' },
                        401: { description: 'Unauthorized' },
                    },
                },
            },
            '/api/ups/rating': {
                post: {
                    tags: ['UPS'],
                    summary: 'UPS rating',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/UPSRateRequest' },
                                examples: {
                                    business: {
                                        summary: 'Business payload (shipper/shipTo)',
                                        value: {
                                            shipper: {
                                                nome: 'Intrex',
                                                telefone: '48999999999',
                                                rua: 'Rua Central',
                                                numero: '123',
                                                cidade: 'Florianopolis',
                                                estado: 'SC',
                                                cep: '88010000',
                                                pais: 'BR',
                                            },
                                            shipTo: {
                                                nome: 'John Doe',
                                                telefone: '3051112222',
                                                rua: 'NW 7th Ave',
                                                numero: '500',
                                                cidade: 'Miami',
                                                estado: 'FL',
                                                cep: '33130',
                                                pais: 'US',
                                            },
                                            serviceCode: '08',
                                            packages: [
                                                { weightKg: 1.2, dimCm: { length: 30, width: 20, height: 10 } },
                                            ],
                                        },
                                    },
                                    shipmentRequest: {
                                        summary: 'ShipmentRequest (UPS format)',
                                        value: {
                                            ShipmentRequest: {
                                                Shipment: {
                                                    Shipper: {
                                                        Address: {
                                                            PostalCode: '88010000',
                                                            CountryCode: 'BR',
                                                            StateProvinceCode: 'SC',
                                                            City: 'Florianopolis',
                                                            AddressLine: ['Rua Central, 123'],
                                                        },
                                                    },
                                                    ShipTo: {
                                                        Address: {
                                                            PostalCode: '33130',
                                                            CountryCode: 'US',
                                                            StateProvinceCode: 'FL',
                                                            City: 'Miami',
                                                            AddressLine: ['NW 7th Ave, 500'],
                                                        },
                                                    },
                                                    Service: { Code: '08' },
                                                    Package: [
                                                        {
                                                            PackageWeight: { UnitOfMeasurement: { Code: 'KGS' }, Weight: '1.2' },
                                                            Dimensions: { UnitOfMeasurement: { Code: 'CM' }, Length: '30', Width: '20', Height: '10' },
                                                        },
                                                    ],
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        200: { description: 'OK' },
                    },
                },
            },
            '/api/ups/shipping': {
                post: {
                    tags: ['UPS'],
                    summary: 'UPS shipping',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/UPSShipRequest' },
                                examples: {
                                    business: {
                                        summary: 'Business payload (ship)',
                                        value: {
                                            shipper: {
                                                nome: 'Intrex',
                                                telefone: '48999999999',
                                                rua: 'Rua Central',
                                                numero: '123',
                                                cidade: 'Florianopolis',
                                                estado: 'SC',
                                                cep: '88010000',
                                                pais: 'BR',
                                                cnpjOuTaxId: '12345678000199',
                                            },
                                            shipTo: {
                                                nome: 'John Doe',
                                                telefone: '3051112222',
                                                rua: 'NW 7th Ave',
                                                numero: '500',
                                                cidade: 'Miami',
                                                estado: 'FL',
                                                cep: '33130',
                                                pais: 'US',
                                            },
                                            serviceCode: '08',
                                            payment: { bill: 'Shipper', account: '123456' },
                                            packages: [
                                                { reference: 'PKG-1', weightKg: 1.2, dimCm: { length: 30, width: 20, height: 10 } },
                                            ],
                                            invoice: {
                                                number: 'INV-1001',
                                                date: '2025-01-20',
                                                currency: 'USD',
                                                items: [
                                                    { description: 'T-shirt', hscode: '610910', countryOfOrigin: 'BR', quantity: 1, unitPrice: 25 },
                                                ],
                                            },
                                            triangulacao: 'DAP',
                                            cotacaoId: 123,
                                        },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        201: { description: 'Created' },
                    },
                },
            },
            '/api/ups/tracking/{tracking}': {
                get: {
                    tags: ['UPS'],
                    summary: 'UPS tracking',
                    parameters: [
                        { name: 'tracking', in: 'path', required: true, schema: { type: 'string' } },
                    ],
                    responses: {
                        200: { description: 'OK' },
                    },
                },
            },
            '/api/ups/shipments': {
                post: {
                    tags: ['UPS'],
                    summary: 'Criar shipment (mock)',
                    requestBody: {
                        required: true,
                        content: { 'application/json': { schema: { type: 'object' } } },
                    },
                    responses: {
                        201: { description: 'Created' },
                    },
                },
            },
            '/api/ups/webhook/ups-tracking': {
                post: {
                    tags: ['UPS'],
                    summary: 'Webhook UPS tracking',
                    requestBody: {
                        required: true,
                        content: { 'application/json': { schema: { type: 'object' } } },
                    },
                    responses: {
                        200: { description: 'OK' },
                    },
                },
            },
            '/api/fedex/rating': {
                post: {
                    tags: ['FedEx'],
                    summary: 'FedEx rating',
                    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/FedexRateRequest' },
                                examples: {
                                    default: {
                                        summary: 'Rate (pedido + caixas)',
                                        value: {
                                            pedido_ref: '1001',
                                            packagesId: [1, 2],
                                            pesoTotalPedidoKg: 3.5,
                                            shipper: {
                                                nome: 'Intrex',
                                                telefone: '48999999999',
                                                rua: 'Rua Central',
                                                numero: '123',
                                                cidade: 'Florianopolis',
                                                estado: 'SC',
                                                cep: '88010000',
                                                pais: 'BR',
                                                cnpjOuTaxId: '12345678000199',
                                            },
                                            recipient: {
                                                nome: 'John Doe',
                                                telefone: '3051112222',
                                                rua: 'NW 7th Ave',
                                                numero: '500',
                                                cidade: 'Miami',
                                                estado: 'FL',
                                                cep: '33130',
                                                pais: 'US',
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        200: { description: 'OK' },
                    },
                },
            },
            '/api/fedex/shipping': {
                post: {
                    tags: ['FedEx'],
                    summary: 'FedEx shipping',
                    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/FedexShipRequest' },
                                examples: {
                                    default: {
                                        summary: 'Ship (pedido + caixas)',
                                        value: {
                                            pedido_ref: '1001',
                                            packagesId: [1, 2],
                                            pesoTotalPedidoKg: 3.5,
                                            freight_total: 42.5,
                                            shipper: {
                                                nome: 'Intrex',
                                                telefone: '48999999999',
                                                rua: 'Rua Central',
                                                numero: '123',
                                                cidade: 'Florianopolis',
                                                estado: 'SC',
                                                cep: '88010000',
                                                pais: 'BR',
                                                cnpjOuTaxId: '12345678000199',
                                            },
                                            recipient: {
                                                nome: 'John Doe',
                                                telefone: '3051112222',
                                                rua: 'NW 7th Ave',
                                                numero: '500',
                                                cidade: 'Miami',
                                                estado: 'FL',
                                                cep: '33130',
                                                pais: 'US',
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        200: { description: 'OK' },
                    },
                },
            },
            '/api/fedex/tracking/{tracking}': {
                post: {
                    tags: ['FedEx'],
                    summary: 'FedEx tracking',
                    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
                    parameters: [
                        { name: 'tracking', in: 'path', required: true, schema: { type: 'string' } },
                    ],
                    responses: {
                        200: { description: 'OK' },
                    },
                },
            },
            '/api/fedex/pickup': {
                post: {
                    tags: ['FedEx'],
                    summary: 'FedEx pickup',
                    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/FedexPickupRequest' },
                                examples: {
                                    passThrough: {
                                        summary: 'FedEx Pickup payload (pass-through)',
                                        value: {
                                            associatedAccountNumber: { value: '123456789' },
                                            originDetail: {
                                                pickupLocation: {
                                                    contact: {
                                                        personName: 'Intrex',
                                                        phoneNumber: '48999999999',
                                                    },
                                                    address: {
                                                        streetLines: ['Rua Central, 123'],
                                                        city: 'Florianopolis',
                                                        stateOrProvinceCode: 'SC',
                                                        postalCode: '88010000',
                                                        countryCode: 'BR',
                                                    },
                                                },
                                                packageLocation: 'FRONT',
                                                readyDateTimestamp: '2025-01-20T13:00:00-03:00',
                                                customerCloseTime: '18:00:00',
                                                pickupDateType: 'SAME_DAY',
                                            },
                                            totalPackageCount: 1,
                                            totalWeight: { units: 'KG', value: 2.5 },
                                            carrierCode: 'FDXE',
                                        },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        200: { description: 'OK' },
                    },
                },
            },
            '/api/fedex/_debug/fedex': {
                get: {
                    tags: ['FedEx', 'Debug'],
                    summary: 'FedEx config debug',
                    responses: {
                        200: { description: 'OK' },
                    },
                },
            },
            '/api/shipments/compare': {
                post: {
                    tags: ['Shipments'],
                    summary: 'Comparar taxas',
                    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
                    requestBody: {
                        required: true,
                        content: { 'application/json': { schema: { type: 'object' } } },
                    },
                    responses: {
                        200: { description: 'OK' },
                    },
                },
            },
            '/api/shipments/{id}/confirm': {
                post: {
                    tags: ['Shipments'],
                    summary: 'Confirmar shipment',
                    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
                    parameters: [
                        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
                    ],
                    responses: {
                        200: { description: 'OK' },
                    },
                },
            },
            '/api/cotacoes': {
                get: {
                    tags: ['Cotacoes'],
                    summary: 'Listar cotacoes',
                    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
                    responses: {
                        200: { description: 'OK' },
                    },
                },
                post: {
                    tags: ['Cotacoes'],
                    summary: 'Criar cotacao',
                    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/CotacaoCreateRequest' },
                                examples: {
                                    ups: {
                                        summary: 'UPS with rate_payload',
                                        value: {
                                            pedido_ref: '1001',
                                            carrier: 'UPS',
                                            serviceCode: '08',
                                            pais_remetente: 'BR',
                                            pais_dest: 'US',
                                            rate_payload: {
                                                RateRequest: {
                                                    Shipment: {
                                                        Shipper: { Address: { CountryCode: 'BR', PostalCode: '88010000' } },
                                                        ShipTo: { Address: { CountryCode: 'US', PostalCode: '33130' } },
                                                        Service: { Code: '08' },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                    fedex: {
                                        summary: 'FedEx with preco_base',
                                        value: {
                                            pedido_ref: '1001',
                                            carrier: 'FEDEX',
                                            serviceCode: 'FEDEX_INTERNATIONAL_CONNECT_PLUS',
                                            preco_base: 40.5,
                                            pais_remetente: 'BR',
                                            pais_dest: 'US',
                                        },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        201: { description: 'Created' },
                    },
                },
            },
            '/api/cotacoes/{id}': {
                get: {
                    tags: ['Cotacoes'],
                    summary: 'Detalhe cotacao',
                    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
                    parameters: [
                        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
                    ],
                    responses: {
                        200: { description: 'OK' },
                    },
                },
            },
            '/api/cotacoes/{id}/details': {
                get: {
                    tags: ['Cotacoes'],
                    summary: 'Detalhes cotacao',
                    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
                    parameters: [
                        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
                    ],
                    responses: {
                        200: { description: 'OK' },
                    },
                },
            },
            '/api/cotacoes/status-por-pedido/{pedido_ref}': {
                get: {
                    tags: ['Cotacoes'],
                    summary: 'Status por pedido',
                    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
                    parameters: [
                        { name: 'pedido_ref', in: 'path', required: true, schema: { type: 'string' } },
                    ],
                    responses: {
                        200: { description: 'OK' },
                    },
                },
            },
            '/api/cotacoes/{id}/docs': {
                post: {
                    tags: ['Cotacoes'],
                    summary: 'Anexar documentos',
                    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
                    parameters: [
                        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
                    ],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/CotacaoAttachDocsRequest' },
                                examples: {
                                    base64: {
                                        summary: 'Base64 upload',
                                        value: {
                                            etiqueta_base64: 'BASE64_DATA',
                                            etiqueta_mime: 'application/pdf',
                                            invoice_base64: 'BASE64_DATA',
                                            invoice_mime: 'application/pdf',
                                            tracking_number: '1Z9999',
                                            carrier: 'UPS',
                                        },
                                    },
                                    urls: {
                                        summary: 'URL upload',
                                        value: {
                                            etiqueta_url: 'https://example.com/label.pdf',
                                            invoice_url: 'https://example.com/invoice.pdf',
                                            tracking_number: '1234567890',
                                            carrier: 'FEDEX',
                                        },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        200: { description: 'OK' },
                    },
                },
            },
            '/api/cotacoes/{id}/etiqueta': {
                get: {
                    tags: ['Cotacoes'],
                    summary: 'Download etiqueta',
                    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
                    parameters: [
                        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
                    ],
                    responses: {
                        200: { description: 'OK' },
                    },
                },
            },
            '/api/cotacoes/{id}/invoice': {
                get: {
                    tags: ['Cotacoes'],
                    summary: 'Download invoice',
                    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
                    parameters: [
                        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
                    ],
                    responses: {
                        200: { description: 'OK' },
                    },
                },
            },
            '/api/cotacoes/{id}/remetente': {
                get: {
                    tags: ['Cotacoes'],
                    summary: 'Remetente da cotacao',
                    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
                    parameters: [
                        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
                    ],
                    responses: {
                        200: { description: 'OK' },
                    },
                },
            },
            '/api/cotacoes/{id}/pickup': {
                post: {
                    tags: ['Cotacoes'],
                    summary: 'Agendar pickup da cotacao',
                    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
                    parameters: [
                        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
                    ],
                    requestBody: {
                        required: false,
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/CotacaoPickupRequest' },
                                examples: {
                                    default: {
                                        summary: 'Schedule UPS pickup',
                                        value: {
                                            pickupDate: '2025-01-20',
                                            readyTime: '09:00',
                                            closeTime: '17:00',
                                        },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        200: { description: 'OK' },
                    },
                },
            },
            '/api/cotacoes/clientes/{id}/plano': {
                patch: {
                    tags: ['Cotacoes'],
                    summary: 'Atualizar plano do cliente',
                    parameters: [
                        { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
                    ],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['plano'],
                                    properties: {
                                        plano: { type: 'string', enum: ['basico', 'premium', 'gold', 'parceiro'] },
                                        motivo: { type: 'string' },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        204: { description: 'No Content' },
                        400: { description: 'Bad Request' },
                    },
                },
            },
            '/api/relatorio/pagamentos.csv': {
                post: {
                    tags: ['Relatorios'],
                    summary: 'Relatorio de pagamentos (CSV)',
                    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
                    requestBody: {
                        required: false,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        from: { type: 'string', format: 'date' },
                                        to: { type: 'string', format: 'date' },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        200: { description: 'CSV' },
                        500: { description: 'Server Error' },
                    },
                },
            },
            '/api/rate/multi': {
                post: {
                    tags: ['Misc'],
                    summary: 'Rate multi',
                    requestBody: {
                        required: true,
                        content: { 'application/json': { schema: { type: 'object' } } },
                    },
                    responses: {
                        200: { description: 'OK' },
                        400: { description: 'Bad Request' },
                    },
                },
            },
            '/upload': {
                post: {
                    tags: ['Uploads'],
                    summary: 'Upload base64',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['base64', 'mime'],
                                    properties: {
                                        base64: { type: 'string' },
                                        mime: { type: 'string' },
                                        ext: { type: 'string' },
                                        prefix: { type: 'string' },
                                        refId: { type: 'string' },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        200: { description: 'OK' },
                        413: { description: 'Payload Too Large' },
                    },
                },
                delete: {
                    tags: ['Uploads'],
                    summary: 'Delete upload',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['key'],
                                    properties: {
                                        key: { type: 'string' },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        200: { description: 'OK' },
                        404: { description: 'Not Found' },
                    },
                },
            },
            '/sse/status': {
                get: {
                    tags: ['SSE'],
                    summary: 'SSE status stream',
                    responses: {
                        200: { description: 'Event stream' },
                    },
                },
            },
            '/boletos': {
                post: {
                    tags: ['Asaas'],
                    summary: 'Gerar boleto',
                    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['dueDate'],
                                    properties: {
                                        clienteId: { type: 'integer' },
                                        dueDate: { type: 'string', format: 'date' },
                                        from: { type: 'string', format: 'date' },
                                        to: { type: 'string', format: 'date' },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        200: { description: 'OK' },
                        400: { description: 'Bad Request' },
                    },
                },
            },
            '/dolar': {
                get: {
                    tags: ['Misc'],
                    summary: 'Cotacao do dolar',
                    responses: {
                        200: { description: 'OK' },
                    },
                },
            },
            '/dashboard/valorTotal': {
                get: {
                    tags: ['Dashboard'],
                    summary: 'Valor total de todas as cotações',
                    responses: {
                        200: { description: 'ok' }
                    }
                }
            },
            '/dashboard/valorMedio/cotacoes': {
                get: {
                    tags: ['Dashboard'],
                    summary: 'Valor medio de todas as cotações',
                    responses: {
                        200: { description: 'ok' }
                    }
                }
            },
            '/dashboard/porcentagem/transportadora': {
                get: {
                    tags: ['Dashboard'],
                    summary: 'Porcentagem de transportadora das cotações',
                    responses: {
                        200: { description: 'ok' }
                    }
                }
            },
            '/dashboard/porcentagem/pais-destinatario': {
                get: {
                    tags: ['Dashboard'],
                    summary: 'Porcentagem de paises destinatarios das cotações',
                    responses: {
                        200: { description: 'ok' }
                    }
                }
            },
            '/dashboard/valorMedio/pais': {
                get: {
                    tags: ['Dashboard'],
                    summary: 'Valor medio das cotações por país',
                    responses: {
                        200: { description: 'ok' }
                    }
                }
            },
            '/dashboard/cotacoesPorData/hoje': {
                get: {
                    tags: ['Dashboard'],
                    summary: 'Pega o valor total das cotações do dia de hoje',
                    responses: {
                        200: { description: 'ok' }
                    }
                }
            },
            '/dashboard/cotacoesPorData/mes': {
                get: {
                    tags: ['Dashboard'],
                    summary: 'Pega o valor total das cotações dos ultimos 30 dias',
                    responses: {
                        200: { description: 'ok' }
                    }
                }
            },
            '/dashboard/cotacoesPorData/ontem': {
                get: {
                    tags: ['Dashboard'],
                    summary: 'Pega o valor total das cotações do dia de ontem',
                    responses: {
                        200: { description: 'ok' }
                    }
                }
            },
            '/dashboard/cotacoesPorData/semana': {
                get: {
                    tags: ['Dashboard'],
                    summary: 'Pega o valor total das cotações dos ultimos 7 dias',
                    responses: {
                        200: { description: 'ok' }
                    }
                }
            },
            '/_debug/shops': {
                get: {
                    tags: ['Debug'],
                    summary: 'Debug shops',
                    responses: {
                        200: { description: 'OK' },
                    },
                },
            },
            '/_debug/scopes': {
                get: {
                    tags: ['Debug'],
                    summary: 'Debug scopes',
                    parameters: [
                        { name: 'shop', in: 'query', required: true, schema: { type: 'string' } },
                    ],
                    responses: {
                        200: { description: 'OK' },
                        400: { description: 'Bad Request' },
                    },
                },
            },
            '/_debug/whoami': {
                get: {
                    tags: ['Debug'],
                    summary: 'Debug auth info',
                    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
                    responses: {
                        200: { description: 'OK' },
                    },
                },
            },
            '/__fedex/oauth-test': {
                get: {
                    tags: ['Debug', 'FedEx'],
                    summary: 'Test FedEx OAuth',
                    responses: {
                        200: { description: 'OK' },
                        500: { description: 'Server Error' },
                    },
                },
            },
        },
    },
    apis: [],
};

const swaggerSpec = swaggerJsdoc(options);

function setupSwagger(app) {
    app.get('/docs.json', (_req, res) => res.json(swaggerSpec));
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

module.exports = {
    swaggerSpec,
    setupSwagger,
};
