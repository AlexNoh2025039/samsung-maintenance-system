import { io } from 'socket.io-client';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);
const SERVER_URL = 'http://localhost:4000';
const stationName = process.env.COMPUTERNAME || 'ESTACION-DESCONOCIDA';

console.log(`🔍 Iniciando Agente local para la estación: ${stationName} ...`);

const socket = io(SERVER_URL);

socket.on('connect', () => {
  console.log(`✅ Agente conectado al servidor central con ID: ${socket.id}`);
  socket.emit('register-station', { stationName });
  
   setInterval(scanDevices, 5000);
});

socket.on('disconnect', () => {
  console.log(`⚠️ Desconectado del servidor central. Intentando reconectar...`);
});

 async function scanDevices() {
  try {
    const { stdout } = await execPromise('adb devices');
    const lines = stdout.split('\n').slice(1);
    const devices = lines
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => {
        const [serialNumber, status] = line.split(/\s+/);
        return { serialNumber, status };
      });

    if (devices.length > 0) {
      console.log(`📱 Dispositivos detectados en USB:`, devices);
       socket.emit('device-status-update', { stationName, devices });
    }
  } catch (error) {
 
  }
}