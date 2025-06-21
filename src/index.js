import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from '../swagger.js';
import disasterRoutes from './routes/disasters.js';
import { mockAuth } from './middlewares/auth.js';
import swaggerSetup from '../swagger.js';


dotenv.config();
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(mockAuth);

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use('/disasters', disasterRoutes);

io.on('connection', socket => {
    console.log('Socket connected:', socket.id);
});

swaggerSetup(app);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
