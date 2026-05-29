import swaggerJsdoc from 'swagger-jsdoc';

export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Tech Interview Study — API',
      version: '1.0.0',
      description: 'Backend API cho quiz app: auth + progress sync',
    },
    servers: [{ url: 'http://localhost:3001', description: 'Dev server' }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            email: { type: 'string', format: 'email' },
            displayName: { type: 'string', nullable: true },
          },
        },
        AuthResponse: {
          type: 'object',
          properties: {
            token: { type: 'string' },
            user: { $ref: '#/components/schemas/User' },
          },
        },
        ProgressData: {
          type: 'object',
          description: 'Map key → boolean, ví dụ: {"javascript:0:0": true}',
          additionalProperties: { type: 'boolean' },
          example: { 'javascript:0:0': true, 'javascript:0:1': false },
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
    },
  },
  apis: ['./src/routes/*.ts'],
});
