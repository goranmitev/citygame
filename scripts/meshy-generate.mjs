#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MESHY_API_KEY = process.env.MESHY_API_KEY;
if (!MESHY_API_KEY) {
  console.error('Error: MESHY_API_KEY environment variable is required.');
  process.exit(1);
}

const BASE_URL = 'https://api.meshy.ai/openapi';
const HEADERS = {
  'Authorization': `Bearer ${MESHY_API_KEY}`,
  'Content-Type': 'application/json',
};

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function apiRequest(method, endpoint, body = null) {
  const url = `${BASE_URL}${endpoint}`;
  return new Promise((resolve, reject) => {
    const options = {
      method,
      headers: HEADERS,
    };
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(`API Error ${res.statusCode}: ${JSON.stringify(json)}`));
          } else {
            resolve(json);
          }
        } catch (e) {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function pollTask(taskId, type = 'text-to-3d', maxAttempts = 60) {
  console.log(`Polling task ${taskId}...`);
  for (let i = 0; i < maxAttempts; i++) {
    const status = await apiRequest('GET', `/v2/${type}/${taskId}`);
    console.log(`Status: ${status.status} (${status.progress || 0}%)`);
    if (status.status === 'SUCCEEDED') {
      return status;
    }
    if (status.status === 'FAILED' || status.status === 'CANCELED') {
      throw new Error(`Task failed: ${status.error || 'Unknown error'}`);
    }
    await sleep(5000); // Poll every 5s
  }
  throw new Error('Task timeout');
}

async function downloadFile(url, outputPath) {
  console.log(`Downloading to ${outputPath}...`);
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outputPath);
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log(`Downloaded: ${outputPath}`);
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(outputPath, () => reject(err));
    });
  });
}

async function generateCar() {
  const outputDir = path.join(__dirname, '../public/assets/models');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const slug = 'car';
  const outputPath = path.join(outputDir, `${slug}.glb`);

  const prompt = "low poly stylized red European sedan car, city driving game asset, detailed wheels with silver rims, headlights and red taillights, simple cabin windows, clean game-ready topology, PBR materials, European style, side view, no background";

  console.log('Generating car model with Meshy AI...');
  console.log('Prompt:', prompt);

  // Step 1: Create preview task
  const previewBody = {
    mode: "preview",
    prompt: prompt,
    ai_model: "meshy-6",
    topology: "triangle",
    target_polycount: 8000,
    symmetry_mode: "auto"
  };

  const previewTask = await apiRequest('POST', '/v2/text-to-3d', previewBody);
  const previewTaskId = previewTask.result || previewTask.id;
  console.log(`Preview task created: ${previewTaskId}`);

  const previewResult = await pollTask(previewTaskId, 'text-to-3d');

  // Step 2: Refine to get PBR textures
  const refineBody = {
    mode: "refine",
    preview_task_id: previewTaskId,
    enable_pbr: true,
    texture_prompt: "realistic car paint with metallic finish, detailed rubber tires, glass windows"
  };

  const refineTask = await apiRequest('POST', '/v2/text-to-3d', refineBody);
  const refineTaskId = refineTask.result || refineTask.id;
  console.log(`Refine task created: ${refineTaskId}`);

  const result = await pollTask(refineTaskId, 'text-to-3d', 90);

  if (result.model_urls && result.model_urls.glb) {
    await downloadFile(result.model_urls.glb, outputPath);
    
    // Create meta file
    const meta = {
      name: 'Car',
      prompt: prompt,
      taskId: refineTaskId,
      generatedAt: new Date().toISOString(),
      polycount: result.poly_count || 'unknown',
      scale: 0.6, // suggested starting scale for game
      rotationY: Math.PI // common for Meshy models
    };
    fs.writeFileSync(path.join(outputDir, `${slug}-meta.json`), JSON.stringify(meta, null, 2));
    
    console.log('\n✅ Success! Car model generated:');
    console.log(`- GLB: public/assets/models/car.glb`);
    console.log(`- Meta: public/assets/models/car-meta.json`);
    console.log('\nNext steps:');
    console.log('1. Update CarSystem.ts to load this GLB using GLTFLoader');
    console.log('2. Adjust scale/position/rotation to match existing physics (CAR_HALF_W=1.0, CAR_HALF_L=2.2)');
    console.log('3. Map wheel meshes for rotation if separate');
    console.log('4. Test in game with npm run dev');
  } else {
    console.error('No GLB URL in response:', result);
  }
}

generateCar().catch(console.error);
