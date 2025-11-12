import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import './BimViewer.css';

// IndexedDB helper functions
const DB_NAME = 'BimViewerDB';
const DB_VERSION = 1;
const STORE_NAME = 'fileHistory';

const openDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
};

const saveFileToIndexedDB = async (id, daeFile, jsonFile = null) => {
  const db = await openDB();
  const transaction = db.transaction([STORE_NAME], 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  
  const item = {
    id,
    daeName: daeFile.name,
    daeSize: daeFile.size,
    daeFile: daeFile, // Store the actual File object
    jsonName: jsonFile?.name || null,
    jsonSize: jsonFile?.size || null,
    jsonFile: jsonFile || null, // Store the actual File object
    timestamp: new Date().toISOString()
  };
  
  store.put(item);
  
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(item);
    transaction.onerror = () => reject(transaction.error);
  });
};

const loadFilesFromIndexedDB = async () => {
  const db = await openDB();
  const transaction = db.transaction([STORE_NAME], 'readonly');
  const store = transaction.objectStore(STORE_NAME);
  const request = store.getAll();
  
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const deleteFileFromIndexedDB = async (id) => {
  const db = await openDB();
  const transaction = db.transaction([STORE_NAME], 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  store.delete(id);
  
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

const clearIndexedDB = async () => {
  const db = await openDB();
  const transaction = db.transaction([STORE_NAME], 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  store.clear();
  
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

const BimViewer = () => {
  const containerRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modelInfo, setModelInfo] = useState(null);
  const [wireframe, setWireframe] = useState(false);
  const [hideText, setHideText] = useState(false);
  const [debugMaterial, setDebugMaterial] = useState(false);
  const [modelTree, setModelTree] = useState([]);
  const [expandedCategories, setExpandedCategories] = useState({});
  const [objectVisibility, setObjectVisibility] = useState({});
  const [modelBrowserSearch, setModelBrowserSearch] = useState('');
  const [showViewsPanel, setShowViewsPanel] = useState(false);
  const [showModelPanel, setShowModelPanel] = useState(true);
  const [fileHistory, setFileHistory] = useState([]);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);
  const objectsMapRef = useRef({});
  const colladaRef = useRef(null);
  const metadataRef = useRef(null);

  // Helper: Parse JSON metadata from ODA TB_JsonExport format
  const parseJsonMetadata = (jsonData) => {
    console.log('\n=== PARSING JSON METADATA ===');
    const elementMap = new Map();
    
    const traverse = (obj, depth = 0) => {
      if (!obj) return;
      
      // If this is an element with an object ID
      if (obj.object && obj.externalId) {
        const elementId = obj.object;
        
        // Extract properties from ODA JSON format
        let family = '';
        let type = '';
        let category = '';
        let familyAndType = '';
        
        if (obj.properties && Array.isArray(obj.properties)) {
          // Find the "Invalid group" section with element metadata
          for (let i = 0; i < obj.properties.length; i++) {
            const item = obj.properties[i];
            if (item === 'Invalid group' && i + 1 < obj.properties.length) {
              const metadata = obj.properties[i + 1];
              family = metadata['Family'] || metadata['Family Name'] || '';
              type = metadata['Type'] || metadata['Type Name'] || '';
              category = metadata['Category'] || '';
              familyAndType = metadata['Family and Type'] || '';
              break;
            }
          }
        }
        
        // Create display name
        let displayName = familyAndType || family || type || `Element_${elementId}`;
        
        elementMap.set(elementId.toString(), {
          elementId: elementId,
          externalId: obj.externalId,
          familyName: family,
          typeName: type,
          category: category,
          displayName: displayName
        });
        
        if (elementMap.size <= 10) {
          console.log(`  Element ${elementId}: "${displayName}" (${category})`);
        }
      }
      
      // Recursively traverse objects array
      if (obj.objects && Array.isArray(obj.objects)) {
        obj.objects.forEach(child => traverse(child, depth + 1));
      }
      if (Array.isArray(obj)) {
        obj.forEach(child => traverse(child, depth + 1));
      }
    };
    
    // Start traversal from data.objects
    if (jsonData && jsonData.data) {
      traverse(jsonData.data);
    } else if (jsonData && jsonData.objects) {
      // Fallback if root has objects
      traverse(jsonData);
    }
    
    console.log(`✓ Loaded ${elementMap.size} elements from JSON`);
    return elementMap;
  };

  // Helper: Get category from OST enum
  const getCategoryFromOST = (ostCategory) => {
    const categoryMap = {
      'OST_CurtainWallPanels': 'Curtain Panels',
      'OST_CurtainWallMullions': 'Curtain Wall Mullions',
      'OST_Walls': 'Walls',
      'OST_Floors': 'Floors',
      'OST_Roofs': 'Roofs',
      'OST_Windows': 'Windows',
      'OST_Doors': 'Doors',
      'OST_Columns': 'Columns',
      'OST_StructuralColumns': 'Structural Columns',
      'OST_StructuralFraming': 'Structural Framing',
      'OST_Furniture': 'Furniture',
      'OST_GenericModel': 'Generic Models'
    };
    return categoryMap[ostCategory] || ostCategory;
  };

  const getElementMetadata = (node) => {
    if (!metadataRef.current || metadataRef.current.size === 0) {
      return null;
    }

    const searchStrings = [
      node.name,
      node.geometry?.name,
      node.material?.name,
      node.id?.toString(),
      node.userData?.revitId,
      node.userData?.guid,
      node.userData?.elementId
    ].filter(s => s).map(s => String(s));

    for (const str of searchStrings) {
      const guidMatch = str.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}(?:-[a-f0-9]{8})?)/i);
      if (guidMatch) {
        const guid = guidMatch[1].toLowerCase();
        
        for (const [, metadata] of metadataRef.current) {
          if (metadata.externalId && metadata.externalId.toLowerCase().includes(guid)) {
            return metadata;
          }
        }
      }
    }

    let elementId = null;

    if (node.name) {
      const idMatch = node.name.match(/(?:Element_|ID_|element-|id-)(\d+)/i);
      if (idMatch) {
        elementId = idMatch[1];
      }
    }

    if (!elementId && node.geometry?.name) {
      const idMatch = node.geometry.name.match(/(?:Element_|ID_|element-|id-)(\d+)/i);
      if (idMatch) {
        elementId = idMatch[1];
      }
    }

    if (!elementId && node.material?.name) {
      const idMatch = node.material.name.match(/(?:Element_|ID_|element-|id-)(\d+)/i);
      if (idMatch) {
        elementId = idMatch[1];
      }
    }

    if (!elementId && node.userData?.elementId) {
      elementId = node.userData.elementId.toString();
    }

    if (elementId) {
      const metadata = metadataRef.current.get(elementId.toString());
      if (metadata) {
        return metadata;
      }
    }

    return null;
  };

  const getNodeDepth = (node) => {
    let depth = 0;
    let current = node;
    while (current.parent) {
      depth++;
      current = current.parent;
    }
    return depth;
  };

  const getParentChain = (node) => {
    const chain = [];
    let current = node;
    while (current.parent) {
      chain.unshift({
        name: current.parent.name || 'unnamed',
        type: current.parent.type
      });
      current = current.parent;
    }
    return chain;
  };

  const loadModel = (modelPath, jsonPath = null) => {
    setLoading(true);
    setError(null);
    setModelInfo(null);
    setModelTree([]);
    setObjectVisibility({});
    objectsMapRef.current = {};

   
    const metadataPath = jsonPath || modelPath.replace(/\.dae$/i, '.metadata.json');
    
    console.log(`\n=== LOADING JSON METADATA ===`);
    console.log(`Model path: ${modelPath}`);
    console.log(`JSON path: ${metadataPath}`);
    console.log(`JSON source: ${jsonPath ? 'uploaded file' : 'auto-detected'}`);

    fetch(metadataPath)
      .then(response => {
        if (response.ok) {
          return response.json();
        } else {
          console.warn('No JSON metadata found, using fallback naming');
          return null;
        }
      })
      .then(jsonData => {
        if (jsonData) {
          metadataRef.current = parseJsonMetadata(jsonData);
          console.log('✓ JSON metadata loaded successfully');
        }
        
        const loader = new ColladaLoader();

        loader.load(
          modelPath,
          (collada) => {
            console.log('\n=== COLLADA LOADED ===');
            
            colladaRef.current = collada;
            
            console.log('Collada object:', collada);
            console.log('Scene:', collada.scene);
            console.log('Library:', collada.library);

        console.log('\n=== COLLADA LIBRARY ANALYSIS ===');
        if (collada.library) {
          console.log('Library keys:', Object.keys(collada.library));
          
          if (collada.library.nodes) {
            console.log('Nodes in library:', Object.keys(collada.library.nodes).length);
            const firstNodes = Object.entries(collada.library.nodes).slice(0, 5);
            firstNodes.forEach(([key, node]) => {
              console.log(`\nNode [${key}]:`, {
                name: node.name,
                id: node.id,
                type: node.type,
                children: node.children?.length,
                userData: node.userData,
                extra: node.extra
              });
            });
          }

          if (collada.library.visualScenes) {
            console.log('\nVisual Scenes:', Object.keys(collada.library.visualScenes));
          }

          if (collada.library.geometries) {
            console.log('Geometries:', Object.keys(collada.library.geometries).length);
            const firstGeoms = Object.entries(collada.library.geometries).slice(0, 3);
            firstGeoms.forEach(([key, geom]) => {
              console.log(`\nGeometry [${key}]:`, {
                name: geom.name,
                type: geom.type,
                userData: geom.userData
              });
            });
          }

          if (collada.library.materials) {
            console.log('Materials:', Object.keys(collada.library.materials).length);
          }

          if (collada.library.images) {
            console.log('Images:', Object.keys(collada.library.images).length);
          }
        }

        const previousModel = sceneRef.current.getObjectByName('model');
        if (previousModel) {
          sceneRef.current.remove(previousModel);
        }

        // Check if scene exists
        if (!collada.scene) {
          console.error('ERROR: Collada scene is null or undefined');
          setError('Model loaded but scene is empty. The DAE file may be corrupted or in an unsupported format.');
          setLoading(false);
          return;
        }

        collada.scene.name = 'model';
        sceneRef.current.add(collada.scene);

        console.log('\n=== SCENE STRUCTURE ===');
        console.log('Scene children count:', collada.scene.children.length);
        
        let meshCount = 0;
        let nodeCount = 0;
        const nodeTypes = {};
        const hierarchyMap = new Map();
        
        collada.scene.traverse((child) => {
          nodeCount++;
          nodeTypes[child.type] = (nodeTypes[child.type] || 0) + 1;
          
          const depth = getNodeDepth(child);
          const parentName = child.parent ? (child.parent.name || child.parent.type) : 'ROOT';
          
          if (!hierarchyMap.has(depth)) {
            hierarchyMap.set(depth, []);
          }
          
          hierarchyMap.get(depth).push({
            name: child.name || 'unnamed',
            type: child.type,
            id: child.id,
            uuid: child.uuid,
            parent: parentName,
            isMesh: child.isMesh,
            childrenCount: child.children.length,
            userData: child.userData,
            extra: child.extra,
            properties: child.properties,
            customData: child.customData
          });
          
          if (child.isMesh) {
            meshCount++;
            
            if (meshCount <= 5) {
              console.log(`\n=== MESH ${meshCount} DETAILS ===`);
              console.log(`  Name: ${child.name}`);
              console.log(`  ID: ${child.id}`);
              console.log(`  UUID: ${child.uuid}`);
              console.log(`  Type: ${child.type}`);
              console.log(`  Parent chain:`, getParentChain(child));
              console.log(`  userData:`, child.userData);
              console.log(`  extra:`, child.extra);
              console.log(`  properties:`, child.properties);
              console.log(`  Geometry:`, {
                name: child.geometry.name,
                type: child.geometry.type,
                userData: child.geometry.userData,
                attributes: Object.keys(child.geometry.attributes)
              });
              console.log(`  Material:`, {
                name: child.material?.name,
                type: child.material?.type,
                userData: child.material?.userData
              });
              console.log(`  Position:`, child.position);
              console.log(`  Scale:`, child.scale);
              console.log(`  Visible:`, child.visible);
              
              if (child.geometry) {
                console.log(`  Vertices: ${child.geometry.attributes.position?.count || 0}`);
                console.log(`  Has normals: ${!!child.geometry.attributes.normal}`);
                console.log(`  Has UVs: ${!!child.geometry.attributes.uv}`);
              }
            }
          }
        });

        console.log('\n=== HIERARCHY BY DEPTH ===');
        for (const [depth, nodes] of hierarchyMap) {
          console.log(`\nDepth ${depth}: ${nodes.length} nodes`);
          if (depth <= 3) { 
            nodes.slice(0, 10).forEach(node => {
              console.log(`  - ${node.name} (${node.type}) [parent: ${node.parent}] [children: ${node.childrenCount}]`);
              if (node.userData && Object.keys(node.userData).length > 0) {
                console.log(`    userData:`, node.userData);
              }
            });
            if (nodes.length > 10) {
              console.log(`  ... and ${nodes.length - 10} more`);
            }
          }
        }

        console.log(`\nTotal nodes: ${nodeCount}`);
        console.log('Node types:', nodeTypes);
        console.log(`Total meshes: ${meshCount}`);

        if (meshCount === 0) {
          console.error('ERROR: No meshes found in the COLLADA scene!');
          setError('Model loaded but contains no mesh geometry. Check the DAE file structure.');
          setLoading(false);
          return;
        }

        const scaleFactor = 0.001; // Assume mm to meters
        console.log(`\nApplying scale factor: ${scaleFactor}`);
        collada.scene.scale.setScalar(scaleFactor);

        let box = new THREE.Box3().setFromObject(collada.scene);
        let center = box.getCenter(new THREE.Vector3());
        let size = box.getSize(new THREE.Vector3());

        console.log('\nBounding box:');
        console.log('  Min:', box.min);
        console.log('  Max:', box.max);
        console.log('  Center:', center);
        console.log('  Size:', size);

        const maxDim = Math.max(size.x, size.y, size.z);

        if (maxDim > 0) {
          const desiredSize = 20.0; // Larger viewing size
          const additionalScale = desiredSize / maxDim;
          console.log(`Additional scale for fitting: ${additionalScale}`);
          collada.scene.scale.multiplyScalar(additionalScale);

          // Recompute bounds after scaling
          box = new THREE.Box3().setFromObject(collada.scene);
          center = box.getCenter(new THREE.Vector3());
          size = box.getSize(new THREE.Vector3());
          
          console.log('\nAfter scaling:');
          console.log('  Final size:', size);
          console.log('  Final center:', center);
        }

        // Center model at origin
        collada.scene.position.sub(center);

        // Position camera to look at the model
        const newMaxDim = Math.max(size.x, size.y, size.z);
        const fov = cameraRef.current.fov * (Math.PI / 180);
        let cameraDistance = Math.abs(newMaxDim / Math.tan(fov / 2));
        cameraDistance *= 2.5;

        if (!isFinite(cameraDistance) || cameraDistance <= 0) {
          cameraDistance = 20;
        }

        console.log(`\nCamera distance: ${cameraDistance}`);
        cameraRef.current.position.set(cameraDistance, cameraDistance, cameraDistance);
        cameraRef.current.lookAt(0, 0, 0);
        controlsRef.current.target.set(0, 0, 0);
        controlsRef.current.update();

        // Count objects and fix materials for Autodesk DAE files
        let objectCount = 0;
        let triangleCount = 0;
        let materialFixCount = 0;

        collada.scene.traverse((child) => {
          if (child.isMesh) {
            objectCount++;

            if (child.geometry) {
              const posCount = child.geometry.attributes.position?.count || 0;
              triangleCount += child.geometry.index
                ? child.geometry.index.count / 3
                : posCount / 3;
            }

            //  Autodesk/Revit DAE files:
            if (child.material) {
              materialFixCount++;

              if (Array.isArray(child.material)) {
                const originalMaterials = [];
                const displayMaterials = [];

                child.material.forEach((mat, idx) => {
                  originalMaterials.push(mat.clone());

                  const displayMat = mat.clone();
                  displayMat.side = THREE.DoubleSide;
                  displayMat.needsUpdate = true;

                  displayMat.opacity = 1.0;
                  displayMat.transparent = false;
                  displayMat.depthWrite = true;
                  displayMat.depthTest = true;

                  if (displayMat.color) {
                    const brightness = displayMat.color.r + displayMat.color.g + displayMat.color.b;
                    if (brightness < 0.5) {
                      displayMat.color.set(0x808080);
                    }
                  } else {
                    displayMat.color = new THREE.Color(0x999999);
                  }

                  displayMaterials.push(displayMat);
                });

                child.material = displayMaterials;
                child.userData.originalMaterials = originalMaterials;
                child.userData.displayMaterials = displayMaterials;
              } else {
                child.userData.originalMaterial = child.material.clone();

                const displayMat = child.material.clone();
                displayMat.side = THREE.DoubleSide;
                displayMat.needsUpdate = true;

                displayMat.opacity = 1.0;
                displayMat.transparent = false;
                displayMat.depthWrite = true;
                displayMat.depthTest = true;

                if (displayMat.color) {
                  const brightness = displayMat.color.r + displayMat.color.g + displayMat.color.b;
                  if (brightness < 0.5) {
                    displayMat.color.set(0x808080);
                  }
                } else {
                  displayMat.color = new THREE.Color(0x999999);
                }

                child.material = displayMat;
                child.userData.displayMaterial = displayMat;
              }
            }

            const triangles = child.geometry.index
              ? child.geometry.index.count / 3
              : (child.geometry.attributes.position?.count || 0) / 3;

            if (triangles < 100) {
              child.userData.isText = true;
            }

            // Ensure geometry normals exist
            if (child.geometry && !child.geometry.attributes.normal) {
              child.geometry.computeVertexNormals();
            }

            child.visible = true;
            child.frustumCulled = false;
          }
        });

        console.log(`\nMaterial fixes applied: ${materialFixCount}`);
        console.log(`Model loaded: ${objectCount} objects, ${Math.round(triangleCount)} triangles`);

        // Log object breakdown
        let textObjects = 0;
        let solidObjects = 0;
        sceneRef.current.traverse((child) => {
          if (child.isMesh) {
            if (child.userData.isText) textObjects++;
            else solidObjects++;
          }
        });
        console.log(`Object breakdown: ${solidObjects} solid objects, ${textObjects} text/annotation objects`);

        setModelInfo({
          name: modelPath.split('/').pop(),
          objects: objectCount,
          triangles: Math.floor(triangleCount),
        });

        buildModelTree(collada.scene);
        setLoading(false);
        
        console.log('=== LOADING COMPLETE ===\n');
      },
      (progress) => {
        if (progress.total > 0) {
          console.log('Loading progress:', (progress.loaded / progress.total * 100).toFixed(2) + '%');
        }
      },
      (error) => {
        console.error('Error loading model:', error);
        setError('Failed to load model: ' + error.message);
        setLoading(false);
      }
    );
      })
      .catch(error => {
        console.error('Error loading JSON metadata:', error);
        const loader = new ColladaLoader();
        loader.load(
          modelPath,
          (collada) => {
            console.log('\n=== COLLADA LOADED (no metadata) ===');
            colladaRef.current = collada;
            
            sceneRef.current.add(collada.scene);
            setLoading(false);
          },
          undefined,
          (error) => {
            console.error('Error loading model:', error);
            setError('Failed to load model: ' + error.message);
            setLoading(false);
          }
        );
      });
  };

  // Load file history from IndexedDB on mount
  useEffect(() => {
    const loadHistory = async () => {
      try {
        const files = await loadFilesFromIndexedDB();
        setFileHistory(files.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)));
      } catch (e) {
        console.error('Failed to load history:', e);
      }
    };
    loadHistory();
  }, []);

  // Save file to history using IndexedDB
  const addToHistory = async (daeFile, jsonFile = null) => {
    try {
      const id = Date.now();
      const item = await saveFileToIndexedDB(id, daeFile, jsonFile);
      
      // Update state with new item
      const newHistory = [item, ...fileHistory].slice(0, 10); // Keep last 10
      setFileHistory(newHistory);
      
      // Clean up old items from IndexedDB
      if (fileHistory.length >= 10) {
        const oldestItem = fileHistory[fileHistory.length - 1];
        await deleteFileFromIndexedDB(oldestItem.id);
      }
    } catch (e) {
      console.error('Failed to save to history:', e);
    }
  };

  // Load from history using stored files
  const loadFromHistory = async (item) => {
    try {
      if (item.daeFile) {
        // Create blob URLs from stored File objects
        const daeUrl = URL.createObjectURL(item.daeFile);
        const jsonUrl = item.jsonFile ? URL.createObjectURL(item.jsonFile) : null;
        loadModel(daeUrl, jsonUrl);
      } else {
        setError('File data not found. This should not happen with IndexedDB.');
      }
    } catch (e) {
      console.error('Failed to load from history:', e);
      setError('Failed to load model from history: ' + e.message);
    }
  };

  // Clear history
  const clearHistory = async () => {
    try {
      await clearIndexedDB();
      setFileHistory([]);
    } catch (e) {
      console.error('Failed to clear history:', e);
    }
  };

  useEffect(() => {
    if (!containerRef.current) return;

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f0);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(
      75,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      1000
    );
    camera.position.set(10, 10, 10);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    const container = containerRef.current;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controlsRef.current = controls;

    // Lights - Enhanced for better BIM visibility
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    const directionalLight1 = new THREE.DirectionalLight(0xffffff, 0.6);
    directionalLight1.position.set(10, 10, 10);
    scene.add(directionalLight1);

    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
    directionalLight2.position.set(-10, -10, -10);
    scene.add(directionalLight2);

    const directionalLight3 = new THREE.DirectionalLight(0xffffff, 0.3);
    directionalLight3.position.set(0, 10, 0);
    scene.add(directionalLight3);

    // Grid (hidden for now - can be toggled later)
    // const gridHelper = new THREE.GridHelper(20, 20);
    // scene.add(gridHelper);

    // Add axis helper to see coordinate system (hidden for now)
    // const axesHelper = new THREE.AxesHelper(5);
    // scene.add(axesHelper);
    // console.log('Axes helper added - RGB = XYZ');

    // Load DAE file automatically (commented out - no default file)
    // console.log('Starting to load model...');
    // loadModel('/test.dae');
    
    // Set loading to false since we're not auto-loading
    setLoading(false);

    const animate = () => {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!container) return;
      const width = container.clientWidth;
      const height = container.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    window.addEventListener('resize', handleResize);

    const resizeObserver = new ResizeObserver(handleResize);
    if (container) {
      resizeObserver.observe(container);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      if (container) {
        resizeObserver.unobserve(container);
      }
      renderer.dispose();
      if (container && renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (rendererRef.current && containerRef.current) {
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      if (width > 0 && height > 0) {
        rendererRef.current.setSize(width, height);
        if (cameraRef.current) {
          cameraRef.current.aspect = width / height;
          cameraRef.current.updateProjectionMatrix();
        }
      }
    }
  }, [showViewsPanel, showModelPanel]);

  const handleFileUpload = (event) => {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;

    // Find the DAE file
    const daeFile = files.find(f => f.name.toLowerCase().endsWith('.dae'));
    if (!daeFile) {
      setError('Please select a DAE file');
      return;
    }

    // Look for matching JSON metadata file
    const baseName = daeFile.name.replace(/\.dae$/i, '');
    const jsonFile = files.find(f => 
      f.name === `${baseName}.metadata.json` || 
      f.name === `${baseName}.json`
    );

    // Create blob URLs
    const daeUrl = URL.createObjectURL(daeFile);
    let jsonUrl = null;
    
    if (jsonFile) {
      jsonUrl = URL.createObjectURL(jsonFile);
      console.log(`✓ Found matching JSON file: ${jsonFile.name}`);
    } else {
      console.warn(`⚠️ No matching JSON file found for ${daeFile.name}`);
      console.warn(`   Looking for: ${baseName}.metadata.json or ${baseName}.json`);
    }

    // Add to history
    addToHistory(daeFile, jsonFile);

    loadModel(daeUrl, jsonUrl);
  };

  const resetCamera = () => {
    if (cameraRef.current && controlsRef.current) {
      cameraRef.current.position.set(10, 10, 10);
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();
    }
  };

  const toggleWireframe = () => {
    if (sceneRef.current) {
      sceneRef.current.traverse((child) => {
        if (child.isMesh && child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(mat => {
              mat.wireframe = !wireframe;
            });
          } else {
            child.material.wireframe = !wireframe;
          }
        }
      });
      setWireframe(!wireframe);
    }
  };

  const toggleTextVisibility = () => {
    if (sceneRef.current) {
      sceneRef.current.traverse((child) => {
        if (child.isMesh && child.userData.isText) {
          child.visible = hideText;
        }
      });
      setHideText(!hideText);
    }
  };


  const extractMeaningfulName = (str) => {
    if (!str) return null;
    
    const idMatch = str.match(/\d{4,}/);
    if (idMatch) {
      return `Element_${idMatch[0]}`;
    }
    
    let cleaned = str
      .replace(/^(node|mesh|geometry|object|element|shape|geom)[-_\s]*/gi, '')
      .replace(/[-_\s]*(node|mesh|geometry|object|element|shape|geom)$/gi, '')
      .replace(/^(ID|id)[-_\s]*/gi, '')
      .trim();
    
    if (cleaned.length > 2 && cleaned.toLowerCase() !== 'node' && cleaned.toLowerCase() !== 'unnamed') {
      return cleaned;
    }
    
    return null;
  };

  const getMeshDisplayName = (node, index) => {
    const metadata = getElementMetadata(node);
    if (metadata) {
      return metadata.displayName;
    }

    if (node.geometry && node.geometry.name) {
      const geomName = extractMeaningfulName(node.geometry.name);
      if (geomName) {
        return geomName;
      }
    }
    
    if (node.material) {
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const mat of materials) {
        if (mat && mat.name) {
          const matName = extractMeaningfulName(mat.name);
          if (matName) {
            return matName;
          }
        }
      }
    }
    
    if (node.name && node.name !== 'node') {
      const nodeName = extractMeaningfulName(node.name);
      if (nodeName) {
        return nodeName;
      }
    }
    
    let current = node.parent;
    let depth = 0;
    while (current && current.type !== 'Scene' && depth < 3) {
      if (current.name && current.name !== 'node') {
        const parentName = extractMeaningfulName(current.name);
        if (parentName) {
          return `${parentName}_${index + 1}`;
        }
      }
      current = current.parent;
      depth++;
    }
    
    return `Element_${node.uuid.substring(0, 8)}`;
  };


  const buildModelTree = (modelScene) => {
    const objectsMap = {};
    const visibilityMap = {};

    console.log('\n=== BUILDING MODEL TREE ===');
    console.log('Building hierarchical tree structure...');

    const hierarchyAnalysis = [];
    const groupNodes = [];
    
    modelScene.traverse((child) => {
      const depth = getNodeDepth(child);
      const info = {
        depth,
        name: child.name || 'unnamed',
        id: child.id,
        uuid: child.uuid,
        type: child.type,
        isMesh: child.isMesh,
        isGroup: child.type === 'Group' || child.type === 'Object3D',
        hasGeometry: child.geometry !== undefined,
        childCount: child.children.length,
        userData: child.userData,
        parent: child.parent ? (child.parent.name || child.parent.type) : null
      };
      
      hierarchyAnalysis.push(info);
      
      if (info.isGroup && info.childCount > 0) {
        groupNodes.push(info);
      }

      if (hierarchyAnalysis.length <= 100) {
        const indent = '  '.repeat(depth);
        const meshIndicator = info.isMesh ? ' [MESH]' : '';
        const groupIndicator = info.isGroup ? ` [GROUP-${info.childCount}]` : '';
        console.log(`${indent}${info.name} (${info.type})${meshIndicator}${groupIndicator}`);
        if (info.userData && Object.keys(info.userData).length > 0) {
          console.log(`${indent}  userData:`, info.userData);
        }
      }
    });

    console.log(`\n=== HIERARCHY ANALYSIS ===`);
    console.log(`Total nodes: ${hierarchyAnalysis.length}`);
    console.log(`Mesh nodes: ${hierarchyAnalysis.filter(h => h.isMesh).length}`);
    console.log(`Group nodes: ${groupNodes.length}`);
    
    if (groupNodes.length > 0) {
      console.log('\n=== GROUP NODES (Potential Categories) ===');
      groupNodes.forEach((group, idx) => {
        if (idx < 20) { // Show first 20 groups
          console.log(`Group ${idx + 1}: "${group.name}" (${group.type})`);
          console.log(`  - Depth: ${group.depth}`);
          console.log(`  - Children: ${group.childCount}`);
          console.log(`  - Parent: ${group.parent}`);
          console.log(`  - UUID: ${group.uuid}`);
          if (group.userData && Object.keys(group.userData).length > 0) {
            console.log(`  - userData:`, group.userData);
          }
        }
      });
      if (groupNodes.length > 20) {
        console.log(`... and ${groupNodes.length - 20} more groups`);
      }
    }

    const tree = [];
    const processedMeshes = new Set();

    if (groupNodes.length > 1) {
      console.log('\n=== BUILDING TREE FROM GROUP NODES ===');
      
      groupNodes.forEach(groupInfo => {
        const groupNode = findNodeByUuid(modelScene, groupInfo.uuid);
        if (!groupNode) return;

        const meshChildren = [];
        let meshIndex = 0;
        groupNode.traverse((child) => {
          if (child.isMesh && child !== groupNode && !processedMeshes.has(child.uuid)) {
            const displayName = getMeshDisplayName(child, meshIndex);
            
            if (meshIndex < 5) {
              console.log(`\n=== DIAGNOSTIC: Mesh ${meshIndex} ===`);
              console.log(`  Display Name: ${displayName}`);
              console.log(`  Node name: ${child.name}`);
              console.log(`  Geometry name: ${child.geometry?.name}`);
              console.log(`  Material name: ${child.material?.name}`);
              console.log(`  Node ID: ${child.id}`);
              console.log(`  UserData:`, child.userData);
              
              const metadata = getElementMetadata(child);
              if (metadata) {
                console.log(`  ✓ MATCHED to JSON:`, metadata.displayName);
              } else {
                console.log(`  ✗ NO MATCH in JSON`);
                console.log(`  Looking for IDs in: ${[child.name, child.geometry?.name, child.material?.name].filter(Boolean).join(', ')}`);
              }
            }
            
            const objectId = child.uuid;
            objectsMap[objectId] = child;
            visibilityMap[objectId] = child.visible;
            processedMeshes.add(child.uuid);

            meshChildren.push({
              id: objectId,
              name: displayName,
              object: child,
              type: child.userData.isText ? 'text' : 'mesh',
              category: extractCategory(child, displayName),
              fullPath: getNodePath(child)
            });
            
            meshIndex++;
          }
        });

        if (meshChildren.length > 0) {
          let categoryName = groupInfo.name;
          
          if (!categoryName || categoryName === 'node' || categoryName === 'unnamed') {
            if (meshChildren.length > 0) {
              const firstChild = meshChildren[0];
              categoryName = extractCategoryFromNode(firstChild.object) || firstChild.category;
            } else {
              categoryName = `Group_${tree.length + 1}`;
            }
          }

          tree.push({
            id: groupInfo.uuid,
            name: categoryName,
            count: meshChildren.length,
            items: meshChildren,
            expanded: expandedCategories[categoryName] || false,
            type: 'group',
            depth: groupInfo.depth
          });
        }
      });
    }

    const uncategorizedMeshes = [];
    let uncategorizedIndex = 0;
    modelScene.traverse((child) => {
      if (child.isMesh && !processedMeshes.has(child.uuid)) {
        const displayName = getMeshDisplayName(child, uncategorizedIndex);
        
        if (uncategorizedIndex < 5) {
          console.log(`\n=== DIAGNOSTIC: Uncategorized Mesh ${uncategorizedIndex} ===`);
          console.log(`  Display Name: ${displayName}`);
          console.log(`  Node name: ${child.name}`);
          console.log(`  Geometry name: ${child.geometry?.name}`);
          console.log(`  Material name: ${child.material?.name}`);
          console.log(`  Node ID: ${child.id}`);
          console.log(`  UserData:`, child.userData);
          
          const metadata = getElementMetadata(child);
          if (metadata) {
            console.log(`  ✓ MATCHED to JSON:`, metadata.displayName);
          } else {
            console.log(`  ✗ NO MATCH in JSON`);
          }
        }
        
        const objectId = child.uuid;
        objectsMap[objectId] = child;
        visibilityMap[objectId] = child.visible;
        processedMeshes.add(child.uuid);

        uncategorizedMeshes.push({
          id: objectId,
          name: displayName,
          object: child,
          type: child.userData.isText ? 'text' : 'mesh',
          category: extractCategory(child, displayName),
          fullPath: getNodePath(child)
        });
        
        console.log(`Mesh ${uncategorizedIndex}: "${displayName}" -> Category: ${extractCategory(child, displayName)}`);
        uncategorizedIndex++;
      }
    });

    if (uncategorizedMeshes.length > 0) {
      console.log(`\n=== CATEGORIZING ${uncategorizedMeshes.length} UNCATEGORIZED MESHES ===`);
      
      const categories = {};
      uncategorizedMeshes.forEach(meshItem => {
        const category = meshItem.category;
        if (!categories[category]) {
          categories[category] = [];
        }
        categories[category].push(meshItem);
      });

      Object.entries(categories).forEach(([categoryName, items]) => {
        tree.push({
          id: categoryName,
          name: categoryName,
          count: items.length,
          items: items,
          expanded: expandedCategories[categoryName] || false,
          type: 'category'
        });
      });
    }

    console.log('\n=== FINAL TREE STRUCTURE ===');
    console.log(`Total categories: ${tree.length}`);
    tree.forEach((category, idx) => {
      console.log(`${idx + 1}. ${category.name} (${category.type}): ${category.count} items`);
      if (idx < 5 && category.items.length > 0) {
        category.items.slice(0, 3).forEach((item, itemIdx) => {
          console.log(`     ${itemIdx + 1}. ${item.name}`);
          console.log(`        Path: ${item.fullPath}`);
        });
      }
    });

    if (metadataRef.current && metadataRef.current.size > 0) {
      let matchedCount = 0;
      let totalElements = 0;
      
      tree.forEach(category => {
        category.items.forEach(item => {
          totalElements++;
          const metadata = getElementMetadata(item.object);
          if (metadata) {
            matchedCount++;
          }
        });
      });
      
      console.log('\n=== JSON METADATA MATCHING ===');
      console.log(`✓ Matched ${matchedCount}/${totalElements} elements to JSON metadata`);
      console.log(`Match rate: ${((matchedCount / totalElements) * 100).toFixed(1)}%`);
    } else {
      console.log('\n⚠️ No JSON metadata loaded - using fallback naming');
    }

    objectsMapRef.current = objectsMap;
    setObjectVisibility(visibilityMap);

    const initialExpanded = {};
    tree.forEach(category => {
      initialExpanded[category.id] = category.expanded;
    });
    setExpandedCategories(initialExpanded);
    setModelTree(tree);
  };

  const findNodeByUuid = (root, uuid) => {
    let found = null;
    root.traverse((child) => {
      if (child.uuid === uuid) {
        found = child;
      }
    });
    return found;
  };

  const extractCategoryFromNode = (node) => {
    // Check material name
    if (node.material && node.material.name) {
      const matName = node.material.name.toLowerCase();
      
      // Common Revit material patterns
      if (matName.includes('column')) return 'Structural Columns';
      if (matName.includes('beam')) return 'Structural Framing';
      if (matName.includes('wall')) return 'Walls';
      if (matName.includes('floor') || matName.includes('slab')) return 'Floors';
      if (matName.includes('door')) return 'Doors';
      if (matName.includes('window')) return 'Windows';
      if (matName.includes('roof')) return 'Roofs';
      if (matName.includes('foundation')) return 'Structural Foundations';
      if (matName.includes('stair')) return 'Stairs';
      if (matName.includes('railing')) return 'Railings';
      if (matName.includes('antenna') || matName.includes('equipment')) return 'Specialty Equipment';
    }

    // Check geometry name
    if (node.geometry && node.geometry.name) {
      const geomName = node.geometry.name.toLowerCase();
      if (geomName.includes('column')) return 'Structural Columns';
      if (geomName.includes('beam')) return 'Structural Framing';
    }

    return null;
  };

  // Helper: Get full path to node
  const getNodePath = (node) => {
    const path = [];
    let current = node;
    while (current && current.name) {
      path.unshift(current.name);
      current = current.parent;
    }
    return path.join(' > ');
  };

  // Helper: Extract category from node and its parents
  const extractCategory = (node, displayName) => {
    const metadata = getElementMetadata(node);
    if (metadata && metadata.category) {
      return getCategoryFromOST(metadata.category);
    }

    // Check if it's a text/annotation
    if (node.userData.isText) {
      return 'Text & Annotations';
    }

    // Use display name for better category detection
    const searchStr = (displayName + ' ' + (node.name || '') + ' ' + 
                      (node.geometry?.name || '') + ' ' +
                      (node.material?.name || '')).toLowerCase();

    // Revit/BIM categories (matching Autodesk Viewer)
    const categoryPatterns = {
      'Curtain Panels': ['curtain panel', 'pannello', 'panel'],
      'Curtain Wall Mullions': ['mullion', 'montante', 'curtain wall mullion'],
      'Structural Columns': ['column', 'pilastri', 'pillar', 'post', 'colum'],
      'Structural Framing': ['beam', 'travi', 'frame', 'brace', 'joist', 'girder', 'purlin'],
      'Structural Foundations': ['foundation', 'fondazioni', 'footing', 'pile', 'base', 'plinth'],
      'Structural Connections': ['connection', 'connessioni', 'connector', 'plate', 'bolt', 'weld', 'gusset'],
      'Walls': ['wall', 'muro', 'pareti', 'partition'],
      'Floors': ['floor', 'pavimento', 'slab', 'deck', 'pianta'],
      'Roofs': ['roof', 'tetto', 'copertura'],
      'Ceilings': ['ceiling', 'soffitto', 'soffit'],
      'Doors': ['door', 'porta'],
      'Windows': ['window', 'finestra'],
      'Stairs': ['stair', 'scala', 'ramp', 'rampa', 'step'],
      'Railings': ['railing', 'ringhiera', 'handrail', 'guardrail', 'balustrade'],
      'Specialty Equipment': ['equipment', 'antenna', 'device', 'rru', 'parabola', 'apparatus'],
      'Generic Models': ['generic', 'model'],
      'Structural Stiffeners': ['stiffener', 'stiffening', 'brace'],
      'Pipes': ['pipe', 'tubo', 'conduit', 'piping'],
      'Ducts': ['duct', 'condotto', 'ductwork'],
      'Cable Trays': ['cable', 'tray', 'cavo', 'conduit'],
      'Lighting Fixtures': ['light', 'lamp', 'fixture', 'luminaire'],
      'Electrical Fixtures': ['electrical', 'elettrico', 'outlet', 'switch'],
      'Electrical Equipment': ['transformer', 'panel', 'switchboard'],
      'Plumbing Fixtures': ['plumbing', 'sink', 'toilet', 'faucet'],
      'Mechanical Equipment': ['hvac', 'mechanical', 'fan', 'pump'],
      'Site': ['site', 'planimetria', 'topography', 'terrain'],
      'Data Devices': ['data', 'device', 'sensor'],
      'Sections': ['sezione', 'section']
    };

    for (const [category, patterns] of Object.entries(categoryPatterns)) {
      for (const pattern of patterns) {
        if (searchStr.includes(pattern)) {
          return category;
        }
      }
    }

    let current = node.parent;
    let depth = 0;
    while (current && current.type !== 'Scene' && depth < 3) {
      if (current.name) {
        const parentStr = current.name.toLowerCase();
        for (const [category, patterns] of Object.entries(categoryPatterns)) {
          for (const pattern of patterns) {
            if (parentStr.includes(pattern)) {
              return category;
            }
          }
        }
      }
      current = current.parent;
      depth++;
    }

    return 'Generic Models';
  };

  const toggleCategoryExpanded = (categoryId) => {
    setExpandedCategories(prev => ({
      ...prev,
      [categoryId]: !prev[categoryId]
    }));
  };

  const toggleObjectVisibility = (objectId) => {
    const object = objectsMapRef.current[objectId];
    if (object) {
      const newVisibility = !object.visible;
      object.visible = newVisibility;

      setObjectVisibility(prev => ({
        ...prev,
        [objectId]: newVisibility
      }));
    }
  };

  const toggleCategoryVisibility = (categoryId) => {
    const category = modelTree.find(cat => cat.id === categoryId);
    if (!category) return;

    const allVisible = category.items.every(item => {
      const obj = objectsMapRef.current[item.id];
      return obj && obj.visible === true;
    });
    const newVisibility = !allVisible;

    category.items.forEach(item => {
      const obj = objectsMapRef.current[item.id];
      if (obj) {
        obj.visible = newVisibility;
        setObjectVisibility(prev => ({
          ...prev,
          [item.id]: newVisibility
        }));
      }
    });
  };

  const getFilteredModelTree = () => {
    if (!modelBrowserSearch.trim()) {
      return modelTree;
    }

    const searchLower = modelBrowserSearch.toLowerCase();
    return modelTree
      .map(category => {
        const filteredItems = category.items.filter(item =>
          item.name.toLowerCase().includes(searchLower) ||
          category.name.toLowerCase().includes(searchLower)
        );
        return {
          ...category,
          items: filteredItems,
          count: filteredItems.length
        };
      })
      .filter(category => category.items.length > 0);
  };

  const toggleDebugMaterial = () => {
    if (sceneRef.current) {
      const newDebugState = !debugMaterial;

      sceneRef.current.traverse((child) => {
        if (child.isMesh && child.material) {
          if (newDebugState) {
            if (Array.isArray(child.material)) {
              if (child.userData.displayMaterials) {
                child.userData.debugMaterials = child.material.map(() =>
                  new THREE.MeshNormalMaterial({ side: THREE.DoubleSide })
                );
                child.material = child.userData.debugMaterials;
              }
            } else {
              if (child.userData.displayMaterial) {
                child.userData.debugMaterial = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
                child.material = child.userData.debugMaterial;
              }
            }
          } else {
            if (Array.isArray(child.material)) {
              if (child.userData.displayMaterials) {
                child.material = child.userData.displayMaterials.map(mat => mat.clone());
                delete child.userData.debugMaterials;
              }
            } else {
              if (child.userData.displayMaterial) {
                child.material = child.userData.displayMaterial.clone();
                delete child.userData.debugMaterial;
              }
            }
          }
        }
      });
      setDebugMaterial(newDebugState);
    }
  };

  const filteredTree = getFilteredModelTree();
  const containerClass = `bim-viewer-container ${showViewsPanel ? 'left-panel-open' : ''} ${showModelPanel ? 'right-panel-open' : ''}`;

  return (
    <div className={containerClass}>
      {/* Top toolbar */}
      <div className="toolbar">
        <h1>{modelInfo ? modelInfo.name : 'BIM 3D Viewer'}</h1>
        <div className="toolbar-actions">
          <input
            type="file"
            accept=".dae,.json"
            multiple
            onChange={handleFileUpload}
            id="file-input"
            style={{ display: 'none' }}
          />
          <label htmlFor="file-input" className="btn">
            Load DAE + JSON
          </label>
          <button onClick={resetCamera} className="btn">
            Reset Camera
          </button>
          {/* Hidden buttons - can be re-enabled later if needed */}
          {/* <button onClick={toggleWireframe} className="btn">
            {wireframe ? 'Solid' : 'Wireframe'}
          </button>
          <button onClick={toggleTextVisibility} className="btn">
            {hideText ? 'Show Text' : 'Hide Text'}
          </button>
          <button onClick={toggleDebugMaterial} className="btn">
            {debugMaterial ? 'Original Material' : 'Debug Material'}
          </button> */}
          <button
            onClick={() => setShowHistoryPanel(!showHistoryPanel)}
            className={`btn ${showHistoryPanel ? 'btn-active' : ''}`}
          >
            History {fileHistory.length > 0 && `(${fileHistory.length})`}
          </button>
          <button
            onClick={() => setShowViewsPanel(!showViewsPanel)}
            className={`btn ${showViewsPanel ? 'btn-active' : ''}`}
          >
            Views
          </button>
          <button
            onClick={() => setShowModelPanel(!showModelPanel)}
            className={`btn ${showModelPanel ? 'btn-active' : ''}`}
          >
            Model browser
          </button>
        </div>
      </div>

      {/* History Panel */}
      {showHistoryPanel && (
        <div className="left-panel" style={{ width: '350px' }}>
          <div className="panel-header">
            <h3>File History</h3>
            {fileHistory.length > 0 && (
              <button 
                onClick={clearHistory} 
                className="btn"
                style={{ fontSize: '12px', padding: '4px 8px' }}
              >
                Clear All
              </button>
            )}
          </div>
          <div className="panel-content">
            {fileHistory.length === 0 ? (
              <div className="empty-state">
                No files loaded yet. Upload a DAE file to see it here.
              </div>
            ) : (
              <div className="history-list">
                {fileHistory.map((item) => (
                  <div key={item.id} className="history-item">
                    <div className="history-item-header">
                      <strong>{item.daeName}</strong>
                      <span className="history-timestamp">
                        {new Date(item.timestamp).toLocaleDateString()} {new Date(item.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="history-item-details">
                      <div>DAE: {(item.daeSize / 1024 / 1024).toFixed(2)} MB</div>
                      {item.jsonName && (
                        <div>JSON: {item.jsonName} ({(item.jsonSize / 1024).toFixed(2)} KB)</div>
                      )}
                    </div>
                    <button 
                      onClick={() => loadFromHistory(item)} 
                      className="btn"
                      style={{ marginTop: '8px', width: '100%' }}
                    >
                      ✓ Load Model
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Left Panel - Views */}
      {showViewsPanel && (
        <div className="left-panel">
          <div className="panel-header">
            <h3>Views</h3>
          </div>
          <div className="panel-content">
            <div className="views-section">
              <div className="view-item active">
                <span className="view-icon">📐</span>
                <span>3D View</span>
              </div>
            </div>
            <div className="views-section">
              <h4>Sheets</h4>
              <div className="view-item">
                <span>000 - PROJECT PARAMETERS</span>
              </div>
              <div className="view-item">
                <span>ARC - P 01 - Site Plan</span>
              </div>
              <div className="view-item">
                <span>ARC - PP 02 - Prospect</span>
              </div>
              <div className="view-item">
                <span>ARC - PP 03 - 3D View</span>
              </div>
              <div className="view-item">
                <span>ARC - PS 01 - Elevation X</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Right Panel - Model Browser */}
      {showModelPanel && (
        <div className="right-panel">
          <div className="panel-header">
            <h3>Model</h3>
          </div>
          <div className="panel-content">
            <div className="search-box">
              <input
                type="text"
                placeholder="Search..."
                value={modelBrowserSearch}
                onChange={(e) => setModelBrowserSearch(e.target.value)}
                className="search-input"
              />
            </div>
            <div className="model-tree">
              {filteredTree.length === 0 ? (
                <div className="empty-state">
                  {modelTree.length === 0 ? 'No model loaded' : 'No results found'}
                </div>
              ) : (
                filteredTree.map((category) => (
                  <div key={category.id} className="tree-category">
                    <div
                      className="category-header"
                      onClick={() => toggleCategoryExpanded(category.id)}
                    >
                      <span className="expand-icon">
                        {expandedCategories[category.id] ? '▼' : '▶'}
                      </span>
                      <span className="category-name">{category.name}</span>
                      <span className="category-count">({category.count})</span>
                      <span
                        className="visibility-toggle"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleCategoryVisibility(category.id);
                        }}
                        title="Toggle visibility"
                      >
                        {category.items.every(item => {
                          const obj = objectsMapRef.current[item.id];
                          return obj && obj.visible === true;
                        }) ? '👁️' : '🚫'}
                      </span>
                    </div>
                    {expandedCategories[category.id] && (
                      <div className="category-items">
                        {category.items.map((item) => (
                          <div key={item.id} className="tree-item">
                            <span
                              className="item-visibility-toggle"
                              onClick={() => toggleObjectVisibility(item.id)}
                              title="Toggle visibility"
                            >
                              {(objectVisibility[item.id] !== false && objectsMapRef.current[item.id]?.visible !== false) ? '👁️' : '🚫'}
                            </span>
                            <span className="item-name">{item.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Info panel */}
      {modelInfo && (
        <div className="info-panel">
          <h3>Model Info</h3>
          <p><strong>Name:</strong> {modelInfo.name}</p>
          <p><strong>Objects:</strong> {modelInfo.objects}</p>
          <p><strong>Triangles:</strong> {modelInfo.triangles.toLocaleString()}</p>
        </div>
      )}

      {/* Loading indicator */}
      {loading && (
        <div className="loading-overlay">
          <div className="loading-spinner"></div>
          <p>Loading 3D model...</p>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="error-overlay">
          <div className="error-message">
            <h3>Error</h3>
            <p>{error}</p>
            <button onClick={() => setError(null)} className="btn">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* 3D Canvas */}
      <div ref={containerRef} className="bim-canvas" />

      {/* Instructions */}
      <div className="instructions">
        <h4>Controls:</h4>
        <ul>
          <li><strong>Rotate:</strong> Left mouse drag</li>
          <li><strong>Pan:</strong> Right mouse drag or Shift + Left drag</li>
          <li><strong>Zoom:</strong> Mouse wheel</li>
        </ul>
      </div>
    </div>
  );
};

export default BimViewer;
