# BIM 3D Viewer - React + Xeokit SDK

A simple React application that displays 3D BIM models in Collada (.dae) format using Xeokit SDK.

## Features

- ✅ Loads Collada (.dae) files exported from your BIM API
- ✅ Interactive 3D viewer with camera controls
- ✅ Displays model statistics (objects, triangles)
- ✅ File upload support
- ✅ API integration ready
- ✅ Responsive UI with modern design

## Prerequisites

- Node.js 14+ and npm
- Your BIM API running on `http://localhost:5000`

## Installation

```bash
npm install
```

## Running the App

```bash
npm start
```

The app will open at `http://localhost:3000`

## Usage

### Option 1: Load from Public Folder (Default)

1. Place your `test.dae` file in the `public` folder (already there)
2. The app will automatically load it on startup

### Option 2: Upload a DAE File

1. Click "Load DAE File" button in the toolbar
2. Select a `.dae` file from your computer

### Option 3: Load from API

Modify `BimViewer.js` to call `loadFromApi(versionId)` with your version ID:

```javascript
// In useEffect or button click handler
loadFromApi("your-version-id-here");
```

## Camera Controls

- **Rotate:** Left mouse drag
- **Pan:** Right mouse drag or Shift + Left drag
- **Zoom:** Mouse wheel
- **Select:** Double-click on object
- **Reset Camera:** Click "Reset Camera" button

## Project Structure

```
Front_3d_BIM/
├── public/
│   ├── index.html
│   └── test.dae          # Your Collada model
├── src/
│   ├── components/
│   │   ├── BimViewer.js   # Main 3D viewer component
│   │   └── BimViewer.css  # Viewer styles
│   ├── App.js
│   ├── App.css
│   ├── index.js
│   └── index.css
├── package.json
└── README.md
```

## API Integration

To integrate with your BIM API:

```javascript
// Load geometry from API
const loadFromApi = async (versionId) => {
  const apiUrl = `http://localhost:5000/api/BimVersion/geometry/${versionId}?format=collada`;
  await loadModel(apiUrl);
};
```

## Why Xeokit SDK (not xeokit-bim-viewer)?

**xeokit-bim-viewer** requires XKT format files (IFC → XKT conversion), while your API exports **Collada (.dae)** files.

**@xeokit/xeokit-sdk** has `ColladaLoaderPlugin` that can load DAE files directly, which is perfect for your use case.

## Next Steps

1. ✅ Test with your `test.dae` file
2. ✅ Integrate with your API endpoints
3. ⏭️ Add metadata display from your API's metadata endpoint
4. ⏭️ Add more controls (section planes, x-ray mode, etc.)
5. ⏭️ Implement model comparison features

## Troubleshooting

### CORS Errors

Ensure your API has CORS enabled for `http://localhost:3000`:

```csharp
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins("http://localhost:3000")
              .AllowAnyMethod()
              .AllowAnyHeader();
    });
});
```

### Model Not Loading

- Check browser console for errors
- Verify the DAE file is valid (check file size > 0)
- Ensure the file path is correct (`/test.dae` in public folder)

## Technologies Used

- React 18
- Xeokit SDK (ColladaLoaderPlugin)
- CSS3 (Modern UI)

## License

MIT
