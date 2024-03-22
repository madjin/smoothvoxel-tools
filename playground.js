/**************************************\
*       Smooth Voxels Playground       *
* Copyright (c) 2024 Samuel Van Egmond *
*           MIT License                *
*    https://smoothvoxels.glitch.me    *
\**************************************/

/* global AFRAME */
/* global THREE */
/* global SVOX */
/* global SCRIPTS */
/* global PALETTES */
/* global Model */
/* global ModelReader */
/* global ModelWriter */
/* global MaterialWriter */
/* global VoxelWriter */
/* global Color */
/* global Voxel */
/* global Material */
/* global VoxToSvox */
/* global SvoxToVox */
/* global SvoxMeshGenerator */
/* global SvoxToAFrameConverter */
/* global GLTFExporter */
/* global editor */
/* global scriptEditor */
/* global Clipboard */

"use strict";

// =====================================================
// /magicavoxel/voxreader.js
// =====================================================

///////////////////////////////////////////////////////////////////////////////////////////////
// https://github.com/FlorianFe/vox-reader.js by Florian Fechner
//
// Manual steps to convert to pure javascript:
//   Copied only .js file contents, without module handling
//   Converted to  class (converted consts in getters and changed all functions to statics)
//   (0, _readInt_1.default)(data)  --> this._readInt(data)
//   In readVox bind _parseVoxChunk --> this._parseVoxChunk.bind(this)
///////////////////////////////////////////////////////////////////////////////////////////////

class VoxReader {
  
  static get BLOCK_SIZE() { return 4; }
  static get HEADER_SIZE() { return 12; }
  static get OFFSET() { return 8; } 

  static readVox(buffer) {
    const data = [...buffer]; // convert buffer to array
    const tokens = this._groupArray(data, this.BLOCK_SIZE);

    // VOX <space> 150 0 0 0
    const id = this._readString(tokens[0]);
    const version = this._readInt(tokens[1]);
    if (id != 'VOX ')
        throw Error(`Id of .vox-file should be "VOX ", found "${id}".`);
    if (version != 150 && version != 200)
        console.warn(`Version of .vox-file structure is "${version}", but 150 or 200 was expected.`);
      
    const riffData = this._readRiffFile(data, this.OFFSET, this._parseVoxChunk.bind(this));
    riffData.children = riffData.children.map((chunk, index) => (Object.assign(Object.assign({}, chunk), { index })));
    
    return this._removeRiffStructure(riffData);
  };

  static _groupArray(array, groupSize) {
    return array.reduce((result, item, index) => {
      const i1 = Math.floor(index / groupSize);
      const i2 = index % groupSize;
      if (i2 == 0)
          result.push([]);
      result[i1].push(item);
      return result;
    }, []);
  };

  static _flatten(array) {
    return [].concat.apply([], array);
  }
  
  static _readInt(data) {
    return (data.map((num, index) => (num * Math.pow(2, (8 * index))))
           .reduce((sum, summand) => sum + summand, 0) << 32) >> 32;
  };

  static _readString(data) {
    return data.map(charCode => String.fromCharCode(charCode)).join('');
  }

  static _readDict(contentData) {
    const dict = {};
    let i = 0;
    const amount = this._readInt(contentData.splice(0, 4));
    while (i < amount) {
        const keyLength = this._readInt(contentData.splice(0, 4));
        const key = this._readString(this._flatten(contentData.splice(0, keyLength)));
        const valueLength = this._readInt(contentData.splice(0, 4));
        const value = this._readString(contentData.splice(0, valueLength));
        i++;
        dict[key] = value;
    }
    return dict;
  };

  static _readRiffFile(buffer, offset, parser) {
    const dataWithoutOffset = buffer.slice(offset);
    const chunks = this._readChunks(dataWithoutOffset, parser);
    return chunks[0];
  };

  static _removeRiffStructure(riffObject) {
    let result = {};
    riffObject.children.forEach((child) => {
        let list = result[child.id];
        if (!list)
            list = [];
        list.push(this._removeRiffStructure(child));
        result[child.id] = list;
    });
    Object.entries(riffObject.data).forEach(([key, value]) => {
        result[key] = value;
    });
    result.index = riffObject.index;
    return result;
  };

  static _readChunks(data, parser) {
    let chunks = [];
    while (data.length != 0) {
        const headerData = data.slice(0, this.HEADER_SIZE);
        const header = this._groupArray(headerData, this.BLOCK_SIZE);
        const chunkId = this._readString(header[0]);
        const contentBytes = this._readInt(header[1]);
        const childrenBytes = this._readInt(header[2]);
        chunks.push(this._createChunk(data, chunkId, contentBytes, childrenBytes, parser));
        data = data.slice(this.HEADER_SIZE + contentBytes);
    }
    return chunks;
  };

  static _createChunk(data, id, contentBytes, childrenBytes, parser) {
    const contentDataEndIndex = this.HEADER_SIZE + contentBytes;
    const childrenDataEndIndex = contentDataEndIndex + childrenBytes;
    const contentData = data.slice(this.HEADER_SIZE, contentDataEndIndex);
    const childrenData = data.slice(contentDataEndIndex, childrenDataEndIndex);
    return {
        id: id,
        data: parser(id, contentData),
        children: this._readChunks(childrenData, parser)
    };
  };

  static _parseVoxChunk(id, contentData) {
    const tokens = this._groupArray(contentData, this.BLOCK_SIZE);
    // base https://github.com/ephtracy/voxel-model/blob/master/MagicaVoxel-file-format-vox.txt
    if (id === 'PACK')
        return {
            numModels: this._readInt(tokens[0])
        };
    if (id === 'SIZE') {
        if (!tokens[0]) {
            console.log('SIZE chunk has no data');
        }
        return {
            x: this._readInt(tokens[0]),
            y: this._readInt(tokens[1]),
            z: this._readInt(tokens[2])
        };
    }
    if (id === 'XYZI')
        return {
            numVoxels: this._readInt(tokens[0]),
            values: tokens
                .slice(1)
                .map((c) => ({ x: c[0], y: c[1], z: c[2], i: c[3] }))
        };
    if (id === 'RGBA')
        return {
            values: tokens
                .map((c) => ({ r: c[0], g: c[1], b: c[2], a: c[3] }))
        };
    // extended https://github.com/ephtracy/voxel-model/blob/master/MagicaVoxel-file-format-vox-extension.txt
    if (id === 'nTRN') {
        const obj = {
            nodeId: this._readInt(contentData.splice(0, 4)),
            nodeAttributes: this._readDict(contentData),
            child: this._readInt(contentData.splice(0, 4)),
            reserved: this._readInt(contentData.splice(0, 4)),
            layer: this._readInt(contentData.splice(0, 4)),
            numFrames: this._readInt(contentData.splice(0, 4)),
            frames: [],
        };
        for (let i = 0; i < obj.numFrames; i++) {
            obj.frames.push(this._readDict(contentData));
        }
        return obj;
    }
    if (id === 'nGRP') {
        const obj = {
            nodeId: this._readInt(contentData.splice(0, 4)),
            nodeAttributes: this._readDict(contentData),
            child: this._readInt(contentData.splice(0, 4)),
            children: [],
        };
        for (let i = 0; i < obj.child; i++) {
            obj.children.push(this._readInt(contentData.splice(0, 4)));
        }
        return obj;
    }
    if (id === 'nSHP') {
        const obj = {
            nodeId: this._readInt(contentData.splice(0, 4)),
            nodeAttributes: this._readDict(contentData),
            numModels: this._readInt(contentData.splice(0, 4)),
            models: [],
        };
        for (let i = 0; i < obj.numModels; i++) {
            obj.models.push([this._readInt(contentData.splice(0, 4)), this._readDict(contentData)]);
        }
        return obj;
    }
    if (id === 'MATL')
        return {
            materialId: this._readInt(contentData.splice(0, 4)),
            materialProperties: this._readDict(contentData),
        };
    if (id === 'LAYR')
        return {
            layerId: this._readInt(contentData.splice(0, 4)),
            layerAttributes: this._readDict(contentData),
            reservedId: this._readInt(contentData.splice(0, 4)),
        };
    if (id === 'rOBJ')
        return {
            renderAttributes: this._readDict(contentData),
        };
    if (id === 'rCAM')
        return {
            cameraId: this._readInt(contentData.splice(0, 4)),
            cameraAttributes: this._readDict(contentData),
        };
    if (id === 'NOTE') {
        const obj = {
            numColorNames: this._readInt(contentData.splice(0, 4)),
            colorNames: [],
        };
        for (let i = 0; i < obj.numColorNames; i++) {
            const stringLength = this._readInt(contentData.splice(0, 4));
            obj.colorNames.push(this._readString(this._flatten(contentData.splice(0, stringLength))));
        }
        return obj;
    }
    if (id === 'IMAP') {
        return {
            indexAssociations: contentData.splice(0, 256),
        };
    }
    return {};
  };
}

// =====================================================
// /magicavoxel/voxtosvox.js
// =====================================================

class VoxToSvox {
  
  static reloadMagicaVoxel(callback, model) {
    const fileUpload = document.createElement('input');
    fileUpload.setAttribute('type', 'file');
    fileUpload.setAttribute('accept', '.vox');

    fileUpload.onchange = this._handleMagicaVoxelUpload.bind(null, callback, model);
    fileUpload.click();
  }

  static _handleMagicaVoxelUpload(callback, model, e) {
    let result = {}
    let file = null;

    if (e.target && e.target.files && e.target.files.length > 0) {
      file = e.target.files[0];
    }

    result.fileName = file.name;

    let reader = new FileReader();

    reader.onload = function() {
      try {
        result.model = VoxToSvox.loadVoxFromBuffer(new Uint8Array(reader.result), model, result.fileName);
      }
      catch(ex) {
        result.error = ex.name + ': ' + ex.message;
      }
      
      callback(result);
    };

    reader.onerror = function() {
      result.error = reader.error;
      callback(result);
    };

    reader.readAsArrayBuffer(file);
  };  
  
  // Buffer from FileReader. reader.readAsArrayBuffer(file) then new Uint8Array(reader.result)
  // pass in an existing model to reload
  //
  // // Typical usage
  // let reader = new FileReader();
  // reader.onload = function() {
  //   let model; // Can be a filled model then it will be a reload / merge
  // 
  //   // Load the current model if there is one and clear the voxels.
  //   model = ModelReader.readFromString(modelString);
  //   model.voxels.reset();
  // 
  //   model = VoxToSvox.loadVoxFromBuffer(new Uint8Array(reader.result), model);
  //   modelString = ModelWriter.writeToString(model, false);
  // };
  // 
  // reader.onerror = function() {
  //   alert(reader.error);
  // };
  // 
  // reader.readAsArrayBuffer(file);  // File from an HTML input
  //
  static loadVoxFromBuffer(buffer, model, modelName) {
    try {
      let setScale = false;
      if (model) {
        model.voxels.reset();      
      }
      else {
        model = ModelReader.readFromString(`
        model
        size = 0
        scale = 0.01
        origin = -y
        ao = #000 1 0.5
        voxels`);
        setScale = true;      
      }
      
      let vox = VoxReader.readVox(buffer);
      let message = this.convertMagicaVoxel(vox, model, modelName, setScale);
      //if (message) {
      //  alert(message);        
      //}
    }
    catch(ex) {
      //alert(ex.message + `\r\n\r\nTry saving using the last version of MagicaVoxel.`);
    }
    
    return model;
  }
  
  static convertMagicaVoxel(vox, model, modelName, setScale) {
    // Alpha channel is unused(?) in Magica voxel, so just use the same material for all
    // If all colors are already available this new material will have no colors and not be written by the modelwriter
    let newMaterial = model.materials.createMaterial(model, modelName, { }, true); 

    // Palette map (since palette indices can be moved in Magica Voxel by CTRL-Drag)
    let iMap = [];
    if (vox.IMAP && vox.IMAP.pal_indices) {
      for (let i = 1; i<=vox.IMAP.pal_indices.length; i++) {
        iMap[vox.IMAP.pal_indices[i-1]] = i;
      }
    }

    let groupIndex = 0;
    vox.XYZI.forEach(function(xyzi) {
      
      // Use the SIZE and nTRN sections from the file to properly align all objects in the .vox file
      let voxSize = vox.SIZE[groupIndex++];
      let voxTranslation = vox.nTRN?.[groupIndex]?.frames[0]?._t ?? `0 0 ${Math.floor(voxSize.z/2)}`;
      voxTranslation = voxTranslation.split(' ').map(v => parseInt(v));
      let translation = { x:voxTranslation[0] - Math.floor(voxSize.x/2),
                          y:voxTranslation[1] - Math.floor(voxSize.y/2),
                          z:voxTranslation[2] - Math.floor(voxSize.z/2)
                        };
      xyzi.values.forEach(function(v) {
        let cId = iMap[v.i] ?? v.i
        let svoxcol = model.materials.findColorByExId(cId);
        if (!svoxcol) {
          let voxcol = vox.RGBA[0].values[v.i-1];
          svoxcol = newMaterial.addColorRGB(voxcol.r/255, voxcol.g/255, voxcol.b/255);
          svoxcol.exId = cId;
        } 
        model.voxels.setVoxel(v.x + translation.x, v.z + translation.z, -v.y - translation.y, new Voxel(svoxcol));
      }, this);
    }, this);

    let bounds   = model.voxels.bounds;
    let maxSize = (Math.max(Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY), bounds.maxZ - bounds.minZ) + 1);
    if (setScale) {
      // Set the scale depending on the size of the model
      let scale = 1 / maxSize;
      scale = Math.round(scale*1000)/1000;
      model.settings.scale = { x:scale, y:scale, z:scale };
    }
    
    let message = '';
    if (groupIndex>1) {
      message += 'This .vox file contains multiple objects which were combined.';
    }
    if (maxSize > 256) {
      message += '\r\nThe resulting size is larger than 256 x 256 x 256, which cannot be properly saved back to .vox.';
    }
    return message;
  }
}

// =====================================================
// /magicavoxel/voxwriter.js
// =====================================================

// https://github.com/FlorianFe/vox-saver.js by Florian Fechner
// Manual conversion to pure javascript:
//   Removed module handling
//   Converted to  class (converted consts in getters and changed all functions to statics)
//   (0, readInt_1.default)(data)  --> this._readInt(data)
//   In readVox binf parseVoxChunk --> this.parseVoxChunk.bind(this)
//   Added default palette handling from https://github.com/kevzettler/parse-magica-voxel/blob/master/src/useDefaultPalette.js

///////////////////////////////////////////////////////////////////////////////////////////////

class VoxWriter {
  
  // https://github.com/ephtracy/voxel-model/blob/master/MagicaVoxel-file-format-vox.txt
  static writeVox(voxStructure) {
    return this._flatten([
        this._writeChars("VOX "),
        this._unreadInt(150),
        this._writeRiffFile(voxStructure)
    ]);
  };  

  static _flatten(arr) {
    let result = [];
    arr.forEach(function(item) {
      if (Array.isArray(item)) {
        let items = this._flatten(item);
        items.forEach(function(subItem) {
          result.push(subItem);
        }, this);
      }
      else {
        result.push(item);
      }
    }, this);
    return result;
  };
   
  static _readString(data) { 
    return data.map(charCode => String.fromCharCode(charCode)).join('');
  }
  
  static _unreadInt(num) {
    // fix signed int (-1 shows as -1,0,0,0)
    const data = [];
    num = num >>> 0;
    for (let i = 0; i < 4; i++) {
        data.push(num % 256);
        num = (num - data[i]) / 256;
    }
    return data;
  };
  
  // see https://en.wikipedia.org/wiki/IEEE_754
  static _signedToUnsigned(signed) {
    return signed < 0 ? signed + 256 : signed;
  };

  static _write4ByteFloat(floatingPointNumber) {
    const floatArray = new Float32Array(1);
    floatArray[0] = floatingPointNumber;
    const byteArray = new Int8Array(floatArray.buffer);
    const reducedByteArray = Array.from(byteArray.slice(0, 4)).map(val => this._signedToUnsigned(val));
    return reducedByteArray.reverse();
  };
  
  static get RANGE_4() { return [0, 1, 2, 3]; }
  static get MAX_OF_4_BYTE_INTEGER() { return Math.pow(2, 32) - 1; }
  
  static _write4ByteInteger(number) {
    if (number % 1 !== 0)
        throw Error("expect number to be an integer. Found: " + number);
    if (number < 0)
        throw Error("expect number to be positive");
    if (number > this.MAX_OF_4_BYTE_INTEGER)
        throw Error("expect number to be less than 2^32");
    return this.RANGE_4.map(index => (number >> (index * 8)) % 256);
  };  
  
  static _writeChars(chars) {
    return chars.split("").map(char => char.charCodeAt(0));
  };
  
  static _writeString(text) {
    const textArray = text.split("");
    return [...this._unreadInt(textArray.length), ...textArray.map(char => char.charCodeAt(0))];
  };
   
  static _unreadDict(data) {
      const entries = Object.entries(data);
      return [this._unreadInt(entries.length), entries.map(([k, v]) => [this._writeString(k), this._writeString(v)])];
  };
  
  static _unparseVoxChunk(id, data) {
    let chunk = [];
    // base https://github.com/ephtracy/voxel-model/blob/master/MagicaVoxel-file-format-vox.txt
    chunk.push(id.toUpperCase().split("").map(char => char.charCodeAt(0)));
    switch (id.toUpperCase()) {
        case "MAIN":
            throw Error("Main Chunk must be placed in root!");
        case "PACK":
            chunk.push(this._write4ByteInteger(4)); // Header Size
            chunk.push(this._write4ByteInteger(0)); // Content Size
            chunk.push(this._unreadInt(data.numModels));
            break;
        case "SIZE":
            chunk.push(this._write4ByteInteger(12)); // Header Size
            chunk.push(this._write4ByteInteger(0)); // no children
            chunk.push(this._write4ByteInteger(data.x));
            chunk.push(this._write4ByteInteger(data.y));
            chunk.push(this._write4ByteInteger(data.z));
            break;
        case "XYZI":
            const xyziValues = data.values.map(v => [v.x, v.y, v.z, v.i]);
            chunk.push(this._write4ByteInteger(4 + 4 * xyziValues.length)); // Header Size
            chunk.push(this._write4ByteInteger(0)); // no children
            chunk.push(this._write4ByteInteger(xyziValues.length));
            chunk.push(this._flatten(xyziValues));
            break;
        case "RGBA":
            const rgbaValues = data.values.map(c => [c.r, c.g, c.b, c.a]);
            chunk.push(this._write4ByteInteger(this._flatten(rgbaValues).length)); // Header Size
            chunk.push(this._write4ByteInteger(0)); // no children
            chunk.push(this._flatten(rgbaValues));
            break;
        default:
            console.warn(`Unknown chunk ${id}`);
            return [];
    }
    return this._flatten(chunk);
  }; 
  
  static _writeMAIN(content) {
    return [
        "MAIN".split("").map(char => char.charCodeAt(0)),
        this._write4ByteInteger(0),
        this._write4ByteInteger(content.length),
        content,
    ];
  };
  
  static _writeRiffFile(voxStructure) {
    let content = [];
    Object.keys(voxStructure).forEach((key) => {
        const value = voxStructure[key];
        if (value === undefined || (this._isObject(value) && Object.keys(value).length === 0)) {
            return;
        }
        content.push(this._unparseVoxChunk(key, value));
    });
    console.log(this._flatten(content));
    content = this._flatten(this._writeMAIN(this._flatten(content)));
    return content;
  };  
  
  static _isObject(value) {
    let type = typeof value;
    return !!value && (type == 'object' || type == 'function');
  }
  
  static getDefaultPalette() {
    // From https://github.com/kevzettler/parse-magica-voxel/blob/master/src/useDefaultPalette.js by Kev Zettler
    // Note that array index 0 is actually palette index 1!!
    const defaultPalette = [
      0xffffff, 0xccffff, 0x99ffff, 0x66ffff, 0x33ffff, 0x00ffff, 0xffccff, 0xccccff, 0x99ccff, 0x66ccff, 0x33ccff, 0x00ccff, 0xff99ff, 0xcc99ff, 0x9999ff, 0x6699ff, 
      0x3399ff, 0x0099ff, 0xff66ff, 0xcc66ff, 0x9966ff, 0x6666ff, 0x3366ff, 0x0066ff, 0xff33ff, 0xcc33ff, 0x9933ff, 0x6633ff, 0x3333ff, 0x0033ff, 0xff00ff, 0xcc00ff, 
      0x9900ff, 0x6600ff, 0x3300ff, 0x0000ff, 0xffffcc, 0xccffcc, 0x99ffcc, 0x66ffcc, 0x33ffcc, 0x00ffcc, 0xffcccc, 0xcccccc, 0x99cccc, 0x66cccc, 0x33cccc, 0x00cccc, 
      0xff99cc, 0xcc99cc, 0x9999cc, 0x6699cc, 0x3399cc, 0x0099cc, 0xff66cc, 0xcc66cc, 0x9966cc, 0x6666cc, 0x3366cc, 0x0066cc, 0xff33cc, 0xcc33cc, 0x9933cc, 0x6633cc, 
      0x3333cc, 0x0033cc, 0xff00cc, 0xcc00cc, 0x9900cc, 0x6600cc, 0x3300cc, 0x0000cc, 0xffff99, 0xccff99, 0x99ff99, 0x66ff99, 0x33ff99, 0x00ff99, 0xffcc99, 0xcccc99, 
      0x99cc99, 0x66cc99, 0x33cc99, 0x00cc99, 0xff9999, 0xcc9999, 0x999999, 0x669999, 0x339999, 0x009999, 0xff6699, 0xcc6699, 0x996699, 0x666699, 0x336699, 0x006699, 
      0xff3399, 0xcc3399, 0x993399, 0x663399, 0x333399, 0x003399, 0xff0099, 0xcc0099, 0x990099, 0x660099, 0x330099, 0x000099, 0xffff66, 0xccff66, 0x99ff66, 0x66ff66, 
      0x33ff66, 0x00ff66, 0xffcc66, 0xcccc66, 0x99cc66, 0x66cc66, 0x33cc66, 0x00cc66, 0xff9966, 0xcc9966, 0x999966, 0x669966, 0x339966, 0x009966, 0xff6666, 0xcc6666, 
      0x996666, 0x666666, 0x336666, 0x006666, 0xff3366, 0xcc3366, 0x993366, 0x663366, 0x333366, 0x003366, 0xff0066, 0xcc0066, 0x990066, 0x660066, 0x330066, 0x000066, 
      0xffff33, 0xccff33, 0x99ff33, 0x66ff33, 0x33ff33, 0x00ff33, 0xffcc33, 0xcccc33, 0x99cc33, 0x66cc33, 0x33cc33, 0x00cc33, 0xff9933, 0xcc9933, 0x999933, 0x669933, 
      0x339933, 0x009933, 0xff6633, 0xcc6633, 0x996633, 0x666633, 0x336633, 0x006633, 0xff3333, 0xcc3333, 0x993333, 0x663333, 0x333333, 0x003333, 0xff0033, 0xcc0033, 
      0x990033, 0x660033, 0x330033, 0x000033, 0xffff00, 0xccff00, 0x99ff00, 0x66ff00, 0x33ff00, 0x00ff00, 0xffcc00, 0xcccc00, 0x99cc00, 0x66cc00, 0x33cc00, 0x00cc00, 
      0xff9900, 0xcc9900, 0x999900, 0x669900, 0x339900, 0x009900, 0xff6600, 0xcc6600, 0x996600, 0x666600, 0x336600, 0x006600, 0xff3300, 0xcc3300, 0x993300, 0x663300, 
      0x333300, 0x003300, 0xff0000, 0xcc0000, 0x990000, 0x660000, 0x330000, 0x0000ee, 0x0000dd, 0x0000bb, 0x0000aa, 0x000088, 0x000077, 0x000055, 0x000044, 0x000022, 
      0x000011, 0x00ee00, 0x00dd00, 0x00bb00, 0x00aa00, 0x008800, 0x007700, 0x005500, 0x004400, 0x002200, 0x001100, 0xee0000, 0xdd0000, 0xbb0000, 0xaa0000, 0x880000, 
      0x770000, 0x550000, 0x440000, 0x220000, 0x110000, 0xeeeeee, 0xdddddd, 0xbbbbbb, 0xaaaaaa, 0x888888, 0x777777, 0x555555, 0x444444, 0x222222, 0x111111, 0x000000
    ];

    let colors = defaultPalette.map(function(hex){
      return {
        b: (hex & 0xff0000) >> 16, 
        g: (hex & 0x00ff00) >> 8, 
        r: (hex & 0x0000ff),      
        a: 1
      }
    });

    return colors;
  }
  
  static findBestPaletteFit(palette, r, g, b, removeBestFit) {
    if (palette.length === 1) {
      throw { name:"SaveError", message:"Too many colors in the model for this Magica Voxel palette." };
    }
    
    let minDistance = Number.MAX_VALUE;
    let bestFit     = -1;
    for (let i=1; i<palette.length-1; i++) {
      let col = palette[i];
      if (col !== null) {
        let distance = (col.r-r)*(col.r-r) + (col.g-g)*(col.g-g) + (col.b-b)*(col.b-b);
        if (distance<minDistance) {
          minDistance = distance;
          bestFit = i;
        }
      }
    }
    
    if (removeBestFit) {
      palette[bestFit] = null;
    }
    
    return bestFit+1; 
  }
}

// =====================================================
// /magicavoxel/svoxtovox.js
// =====================================================

const SIZE = 20;
const RADIUS = 8;

class SvoxToVox { 
  
  static saveVoxToBuffer(model) {
    model.prepareForWrite();

    // Determine actually used colors (e.g. not shell color Id's)
    let colorsCounts = {};
    model.voxels.forEach(function(voxel) {
      if (voxel) {
        if (colorsCounts[voxel.color.id])
          colorsCounts[voxel.color.id]++;
        else
          colorsCounts[voxel.color.id] = 1;
      }
    }, this);
    
    // Order them so the most used colors get the best palette picks
    let colorsOrdered = [];
    for (const colorId in colorsCounts) {
      colorsOrdered.push({ color:model.colors[colorId], count:colorsCounts[colorId]})
    }
    colorsOrdered.sort((a,b) => b.count - a.count);
    this._determinePaletteIds(colorsOrdered);
    
    let xyziValues = [];
    model.voxels.forEach(function(voxel) {
      if (voxel) {
        xyziValues.push( { x:voxel.x-model.voxels.bounds.minX, 
                           y:model.voxels.bounds.maxZ-voxel.z, 
                           z:voxel.y-model.voxels.bounds.minY, 
                           i:voxel.color.exId
                         } );
      }
    }, this);
    
    let voxData = {
      size: { x:model.size.x, y: model.size.z, z: model.size.y },
      xyzi: {
          numVoxels: model.voxels.count,
          values: xyziValues
      },
      rgba: {
          values: VoxWriter.getDefaultPalette()
      }
    }
    
    let voxBuffer= VoxWriter.writeVox(voxData);
    
    return voxBuffer;
  }
  
  static _determinePaletteIds(colors) {
    let ids = { };
    let palette = VoxWriter.getDefaultPalette();
    
    colors.forEach(function(c) {
      const color = c.color;
      if (Number.isFinite(color.exId) && color.count > 0) {
        if (palette[color.exId] !== null) {
          ids[color.id] = color.exId;
          palette[color.exId] = null; // Do not use for another color;
        }
        else
          color.exId = null; // The id is used already, so reassign this one below
      }
    }, this);
    
    colors.forEach(function(c) {
      const color = c.color;
      if (!Number.isFinite(color.exId) && color.count > 0) {
        color.exId = VoxWriter.findBestPaletteFit(palette, 
                                                 Math.round(color.r*255), 
                                                 Math.round(color.g*255), 
                                                 Math.round(color.b*255), 
                                                 true); // Remove this id from the palette
        ids[color.id] = color.exId;
      }
    }, this);
    
    return ids;
  }
  
}

// =====================================================
// /playground/vrcontrols.js
// =====================================================

const KeyboardEvent = window.KeyboardEvent;

AFRAME.registerComponent('vrcontrols', {
    schema: {
      container: { default: "#container" }
    },

    init: function () {
      let data = this.data;
      this.container = document.querySelector(this.data.container);
      this.clock = new THREE.Clock();
      
      this.buttonPressed = false;
      this.scale  = 1;
      this.height = 1;
      this.angle  = 0;
    
      this._attachEventListeners();
    },
  
    _attachEventListeners() {
      this.el.addEventListener('buttondown', evt => {
        this.buttonPressed = true;
      });

      this.el.addEventListener('buttonup', evt => {
        this.buttonPressed = false;
      });
              
      this.el.sceneEl.canvas.addEventListener("touchstart", evt => {
        this.buttonPressed = true;
      });

      this.el.sceneEl.canvas.addEventListener("touchend", evt => {
        this.buttonPressed = false;
      });

      this.el.addEventListener("axismove", event => {
       // Oculus Go Snap Turn
       //let debugAxisState = JSON.stringify(event.detail);
       let x = event.detail.axis[0];
       let y = event.detail.axis[1];
       
       this._handleControls(x,y) 
      });
            
      this.el.addEventListener("thumbstickmoved", event => {      
        // Oculus Quest Snap Turn
       let x = event.detail.x;
       let y = event.detail.y;

       this._handleControls(x,y) 
      });       
    },
  
    _removeEventListeners: function() {
  
    },
  
    _handleControls: function(x, y) {
      if (x<-0.2 || x>0.2) {
        if (!this.buttonPressed) {
          this.height += y/this.clock.getDelta();

          this.angle += (1 + x/this.clock.getDelta());
          this.angle = this.angle % 360;
        }
        else {
          this.scale *= y/this.clock.getDelta();           
        }
      }
      this.container.object3D.scale.set(this.scale, this.scale, this.scale);
      this.container.object3D.rotation.set(0, this.angle, 0);
      this.container.object3D.position.set(0, this.height, 0);
    },    
  
  
  ///////////////////////////////////////////////////////
  
  play: function () {
    this._attachEventListeners();
  },

  pause: function () {
    this._removeEventListeners();
  },

  remove: function () {
    this.pause();
  },
  
});

// =====================================================
// /playground/clipboard.js
// =====================================================

class Clipboard {
  
  static readSupported() {
    return (!!(navigator.clipboard && navigator.clipboard.readText) ||
            !!(window.clipboardData && window.clipboardData.getData) ||
            !!(document.queryCommandSupported && document.queryCommandSupported('paste')));
  }

  static read(callback) {
    if (navigator.clipboard && navigator.clipboard.readText) {
      // Use the modern Clipboard API if available
      navigator.clipboard.readText()
        .then(function(text) {
          callback(text);
        })
        .catch(function(err) {
          console.error('Failed to read from clipboard: ' + err);
          callback(null);
        });
    } else if (window.clipboardData && window.clipboardData.getData) {
      // Fallback to window.clipboardData for older browsers
      var text = window.clipboardData.getData('Text');
      if (text) {
        callback(text);
      } else {
        console.error('Failed to read from clipboard.');
        callback(null);
      }
    } else if (document.queryCommandSupported && document.queryCommandSupported('paste')) {
      // Fallback using hidden input element and paste event
      var input = document.createElement('input');
      input.style.position = 'fixed';
      input.style.opacity = 0;
      document.body.appendChild(input);
      input.focus();

      try {
        input.select();
        if (document.execCommand('paste')) {
          var text = input.value;
          callback(text);
        } else {
          throw 'Failed to read from clipboard.';
        }
      } catch (err) {
        console.error(err);
        callback(null);
      }

      document.body.removeChild(input);
    } else {
      console.error('Clipboard handling including all fallbacks are not supported on this platform.');
      callback(null);
    }
  }

  static writeSupported() {
    return (!!(navigator.clipboard && navigator.clipboard.writeText) ||
            !!(window.clipboardData && window.clipboardData.setData) ||
            !!(document.queryCommandSupported && document.queryCommandSupported('copy')));
  }

  static write(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      // Use the modern Clipboard API if available
      navigator.clipboard.writeText(text)
        .then(function() {
          console.log('Text copied to clipboard');
        })
        .catch(function(err) {
          console.log('Unable to copy text to clipboard');
        });
    } else if (window.clipboardData && window.clipboardData.setData) {
      // Fallback to window.clipboardData for older browsers
      window.clipboardData.setData('Text', text);
      console.log('Text copied to clipboard');
    } else if (document.queryCommandSupported && document.queryCommandSupported('copy')) {
      // Fallback to the execCommand
      var pre = document.createElement('pre');
      pre.setAttribute('contenteditable', 'true');
      pre.innerHTML = text;
      pre.style.position = 'fixed';
      pre.style.opacity = 0;
      document.body.appendChild(pre);
      this._selectElementContents(pre);

      try {
        var successful = document.execCommand('copy');
        if (successful) {
          //console.log('Text copied to clipboard');
        } else {
          console.log('Failed to write text to clipboard');
        }
      } catch (err) {
        console.error('Failed to write text to clipboard: ' + err)
      }

      document.body.removeChild(pre);
    }
  }

  static _selectElementContents(el) {
      var range = document.createRange();
      range.selectNodeContents(el);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
  }

}

// =====================================================
// /playground/playground.js
// =====================================================

/* ------ Startup functions ------ */

function fillModels() {
  let models = document.getElementById('models');
  
  render(models, 'option', { 
    value: "filename",
    disabled: "",
  }, "Select a model to render");
  for(let modelName in SVOX.models){
    if (!modelName.startsWith('__')) {
      render(models, 'option', { 
        value: modelName    
      },
      makeReadable(modelName));
    }
  }
}

function fillScripts() {
  let scripts = document.getElementById('scripts');
  render(scripts, 'option', { 
    value: "filename",
    disabled: "",
  }, "Select a script to render");  
  for (let s=0; s < SCRIPTS.length; s++) {
    render(scripts, 'option', {
      value: SCRIPTS[s].name    
    }, makeReadable(SCRIPTS[s].name));
  } 
}

function fillPalettes() {
  let palettes = document.getElementById('palettes');
  for (let f=0; f < PALETTES.length; f++) {
    // Calculate the palette size if it is not set
    if (!PALETTES[f].size)
      PALETTES[f].size = PALETTES[f].colors.split('#').length - 1
    
    render(palettes, 'option', {
      value: PALETTES[f].name    
    }, makeReadable(PALETTES[f].name));
  } 
}

function makeReadable(name) {
  return name.replace(/([a-z])([A-Z])/g, '$1 $2')
             .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
             .replace(/([a-zA-Z])([0-9])/g, '$1 $2')
             .replace(/([0-9])([a-zA-Z])/g, '$1 $2');
}

/* ------ Drop down selections ------ */

function onChooseModel(renderAfterToggle = true) {
  
  document.getElementById('models').options[0].text = "Select a model to render";
  let name = document.getElementById('models').value;
  let modelString = SVOX.models[name].trim() + '\r\n';
  
  let decompress = modelString.includes('voxelscompressed');
  if (decompress) {
    modelString = modelString.replace('voxelscompressed', 'voxels');
    editor.setValue(modelString, -1);
    onDecompressVoxels();
  }
  else {
    editor.setValue(modelString, -1);    
  }
  
  editor.gotoLine(1);

  if (!autoRender && renderAfterToggle)
    renderModel();
}

function onChooseScript(generate) {
  if (generate === undefined) generate = true;
  let name = document.getElementById('scripts').value.trim();
  let script = SCRIPTS.find(f => f.name === name);
  document.getElementById('size').value = script.size;
  document.getElementById('palettes').value = script.palette || 'Gold';
  document.getElementById('direction').value = script.direction || 'Up';
  document.getElementById('form').value = script.form || 'Smooth';
  scriptEditor.setValue(script.script.trim(), -1);
  scriptEditor.gotoLine(1);
  if (generate)
    generateModel();
  else
    setCurrentName(getCurrentScriptName());
}

function onChoosePalette() {
  let name = document.getElementById('palettes').value;
  let palette = PALETTES.find(p => p.name === name);
  if (palette.size === 1)
    document.getElementById('direction').classList.add('hide');
  else
    document.getElementById('direction').classList.remove('hide');
}

/* ------ Reset the view ------ */

SVOX.VRRIGHEIGHT = 1-1.25;
function resetFlyingCamera() {  
  let scene = document.getElementById('scene');
  let rig = document.getElementById('rig');
  let camera = document.getElementById('camera');
  let fps = document.getElementById('fps');
  
  if (fps)
    toggleFps();
  
  // Only repositioning does not work because the controls remember the position and reposition the camera again.
  // So remove the entire camera including the movement-controls.

  if (rig) {
    if (camera)
      rig.removeChild(camera);
    scene.removeChild(rig);
  } 
  
  rig = render(scene, 'a-entity', {
    id: 'rig',
    position: { x:0, y:SVOX.VRRIGHEIGHT, z:1.25 },
    'movement-controls': { fly:true }
  });
  
  // Recreate the camera, which unfortunatly triggers a known 
  // a-frame bug (#3242) which sets the wrong camera aspect ratio.
  camera = render(rig, 'a-entity', {
    id: 'camera',
    camera: '',
    'look-controls': { },
    'vrcontrols': {}
  });
  
  // Automatic height calibration in VR
  setTimeout(function() {
    let newVrRigHeight = 1-camera.object3D.position.y;
    if (Math.abs(SVOX.VRRIGHEIGHT - newVrRigHeight) > 0.05) {
      // Since height calibration is very noticeable, don't do it if it is not needed.
      rig.object3D.position.y = newVrRigHeight;
    }
    SVOX.VRRIGHEIGHT = newVrRigHeight;
  },1000);
  
  if (fps) {
    toggleFps();
  }
  
  resetCameraAspectRatio();
}

function resetCameraAspectRatio() {
  // To reset the aspect ratio we need to resize the window
  // But first hide the scene off screen. This prevents the user 
  // from seeing this deformed image, now they see a flicker which is less ugly.
  let scene = document.getElementById('scene');
  scene.style.top = "-10000px";     
  setTimeout(function() {
    let evt = document.createEvent('UIEvents');
    evt.initUIEvent('resize', true, false,window,0);
    window.dispatchEvent(evt);       
    scene.style.top = 0;
  }, 0);  
}

function resetOrbitCamera() {  
  let scene = document.getElementById('scene');
  let rig = document.getElementById('rig');
  let camera = document.getElementById('camera');
  let fps = document.getElementById('fps');

  if (fps)
    toggleFps();
  
  // Only repositioning does not work because the controls remember the position and reposition the camera again.
  // So remove the entire camera including the movement-controls.

  if (camera)
    camera.parentNode.removeChild(camera);
  if (rig)
    rig.parentNode.removeChild(rig);
  
  rig = render(scene, 'a-entity', {
    id: 'rig',
    position: { x:0, y:0.5, z:0 }
  });
  
  // Recreate the camera, which unfortunatly triggers a known 
  // a-frame bug (#3242) which sets the wrong camera aspect ratio.
  camera = render(rig, 'a-entity', {
    id: 'camera',
    camera: { },
    'tracked-controls': {  },
    'playground-controls': { distance:1.5, elevation:30 }
  });
  
  if (fps) {
    toggleFps();
  }
  
  // To reset the aspect ratio we need to resize the window
  // But first hide the scene off screen. This prevents the user 
  // from seeing this deformed image, now they see a flicker which is less ugly.
  scene.style.top = "-10000px";     
  setTimeout(function() {
    let evt = document.createEvent('UIEvents');
    evt.initUIEvent('resize', true, false,window,0);
    window.dispatchEvent(evt);       
    scene.style.top = 0;
  }, 0);
}

/* ------ Toggles ------ */

let autoRender = false;
function toggleAutoRender() {
  autoRender = !autoRender;
  setRadioButtons("toggleAutoRender", "Render", "Auto", "Off", autoRender);
  if (autoRender) {
    renderModel(); 
  }
}

let sceneEnv = 3;
let sceneEnvs = environments.map(e => e.name);
function toggleScene() {
  sceneEnv = (sceneEnv+1) % sceneEnvs.length;
  setOptions("toggleScene", "Scene", sceneEnvs, sceneEnvs[sceneEnv]);
  changeScene()
}

let background = false;
function toggleBackground() {
  background = !background;
  setRadioButtons("toggleBackground", "Background", "On", "Off", background);
  changeScene()
}

let environment = false;
function toggleEnvironment() {
  environment = !environment;
  setRadioButtons("toggleEnvironment", "Env. Map", "On", "Off", environment);
  changeScene()
}

function changeScene() {
  let scene = document.getElementById('scene');
  if (scene) {
    let envMap = environments[sceneEnv].envMap;
    scene.object3D.environment = environment ? envMap : null; 
    if (background) {
      scene.object3D.background = background ? envMap : null; 
    }
    else {
      scene.object3D.background = new THREE.Color(environments[sceneEnv].backgroundColor);
    }
  }  
}

let baseVisible = false;
function toggleBaseVisible() {
  baseVisible = !baseVisible;
  setRadioButtons("toggleBaseVisible", "Base", "On", "Off", baseVisible);
  
  let base = document.getElementById('base');
  base.setAttribute("visible",baseVisible);
}

let lights = false;
function toggleLights() {
  lights = !lights;
  setRadioButtons("toggleLights", "Lights", "On", "Off", lights);
  
  let lightEls = document.getElementsByClassName('light');
  for (let l=0; l<lightEls.length; l++) {
    lightEls[l].setAttribute("visible", lights);  
  }
}

let rotateModel = false;
function toggleRotate() {
  rotateModel = !rotateModel;
  setRadioButtons("toggleRotate", "Rotate", "On", "Off", rotateModel);

  let container = document.getElementById('container');
  if (rotateModel) {
    container.setAttribute('animation', 'property:rotation; from:0 360 0; to:0 0 0; loop: true; easing:linear; dur:10000');
  }
  else {
    container.removeAttribute('animation');
    container.setAttribute('rotation', '0 0 0');
  }
}

let shadow = false;
function toggleShadow() {
  shadow = !shadow;
  setRadioButtons("toggleShadow", "Shadow", "On", "Off", shadow);
 
  let model = document.getElementById('model');
  if (model)
    model.setAttribute('shadow', { cast: shadow, receive: shadow } );
  let base = document.getElementById('base');
  if (base)
    base.setAttribute('shadow', { cast: shadow, receive: shadow } );
}

let fpsEnabled = true;
function toggleFps() {
  let scene = document.getElementById('scene');
  let camera = document.getElementById('camera');
  let fps = document.getElementById('fps');
  
  if (!camera)
    return;
      
  fpsEnabled = !fpsEnabled;
  setRadioButtons("toggleFps", "FPS", "On", "Off", fpsEnabled);

  if (fpsEnabled) {
    fps = render(camera, 'a-text', {  
      id:"fps",
      position: {x:0, y:-0.1, z:-0.4 },
      'fps-counter': { },
      width: '0.4'
    });
  }
  else {
    if (fps) {
      camera.removeChild(fps);
    }
  }
}

SVOX.showNormals = true;
function toggleShowNormals(renderAfterToggle = true) {
  
  SVOX.showNormals = !SVOX.showNormals;
  setRadioButtons("toggleShowNormals", "Show normals", "On", "Off", SVOX.showNormals);

  if (renderAfterToggle) {
    renderModel();
  }
}

SVOX.showWarnings = false;
function toggleShowWarnings() {
  SVOX.showWarnings = !SVOX.showWarnings;
  setRadioButtons("toggleShowWarnings", "Show warnings", "On", "Off", SVOX.showWarnings);
}

SVOX.colorManagement = false;
function toggleColorManagement(renderAfterToggle = true) {
  
  SVOX.colorManagement = !SVOX.colorManagement;
  setRadioButtons("toggleColorManagement", "Color mgt.", "On", "Off", SVOX.colorManagement);
  let scene = document.getElementById('scene');
  scene.renderer.colorManagement = SVOX.colorManagement;
  let container = document.getElementById('container');
  let base = document.getElementById('base');
  base.remove();
  render(container, 'a-entity', { id:"base", svox:"model:__base", shadow:'', visible:baseVisible });
  
  if (renderAfterToggle) {
    renderModel();
  }
}

SVOX.clampColors = true;
function toggleClampColors(renderAfterToggle = true) {
  
  SVOX.clampColors = !SVOX.clampColors;
  setRadioButtons("toggleClampColors", "Clamp colors", "On", "Off", SVOX.clampColors);
  
  if (renderAfterToggle) {
    renderModel();
  }
}

function setRadioButtons(id, prefix, trueValue, falseValue, value) {
  const RADIOON  = `<font color="#08F">&#x25C9;</font>`;
  const RADIOOFF = `&#x25CE;`;
  let element = document.getElementById(id);
  let text = `<span style="display: flex; justify-content: space-between"><span>${prefix}&nbsp;</span>` + 
             `<span>${value?RADIOON:RADIOOFF}${trueValue} ${!value?RADIOON:RADIOOFF}${falseValue}</span></span>`;
  element.innerHTML = text;
}

function setOptions(id, prefix, values, value) {
  let element = document.getElementById(id);
  let text = `<span style="display: flex; justify-content: space-between"><span>${prefix}&nbsp;</span><span>${value}</span></span>`;
  element.innerHTML = text;
}

/* ------ Name handling -------*/

function setCurrentName(name) {
  if (name.lastIndexOf(".") !== -1) {
    name = name.substr(0, name.lastIndexOf("."));
  }

  let models = document.getElementById('models');
  if (models.options.length > 0) {
    models.options[0].text = name;
    models.options[0].selected = true;  
  }
}

function getCurrentName() {
  let models = document.getElementById('models');
  return models.options[models.selectedIndex].text;  
}

function setCurrentScriptName(name) {
  if (name.endsWith('.txt')) {
    name = name.slice(0, -4);
  }
  if (name.endsWith('.script.svox')) {
    name = name.slice(0, -12);
  }
  let scripts = document.getElementById('scripts');
  if (scripts.options.length > 0) {
    scripts.options[0].text = name;
    scripts.options[0].selected = true;  
  }
}

function getCurrentScriptName() {
  let scripts = document.getElementById('scripts');
  return scripts.options[scripts.selectedIndex].text;  
}

/* ------ Rendering the model ------ */

function renderModel() {
  document.getElementById('svoxwarnings').innerHTML = '';
  document.getElementById('svoxerrors').innerHTML = '';
  document.getElementById('svoxstats').innerHTML = 'Rendering...';
  document.getElementById('spinner').classList.add('spin');
   
  window.setTimeout(function() {
    let model = document.getElementById('model');
    if (model)
      model.parentNode.removeChild(model);

    SVOX.models.__playground = editor.getValue().replace('%ENVIRONMENT%', environments[sceneEnv].envMapBase64).trim();
    if (SVOX.models.__playground !== '') {
    let container = document.getElementById('container');
      model = render(container, 'a-entity', {
        id: "model",
        svox: { model: "__playground", worker:false },
        shadow: { cast: shadow, receive: shadow }
      });   
    }
    else {
      // No model
    }
    if (document.getElementById('svoxstats').innerHTML === 'Rendering...')
      document.getElementById('svoxstats').innerHTML = '';
    document.getElementById('spinner').classList.remove('spin');
  },20);
}

/* ------ Generating a model from a script and palette ------ */

function generateModel() {
  try {
    setCurrentName(getCurrentScriptName());
    
    document.getElementById('scripterrors').innerHTML = '';
    
    let sizeText = document.getElementById('size');
    let size = parseInt(Math.min(Math.max(1, sizeText.value),200));
    sizeText.value = size.toString();
    
    let paletteName = document.getElementById('palettes').value;
    let palette = PALETTES.find(p => p.name === paletteName);
    let direction = document.getElementById('direction').value;

    let script = scriptEditor.getValue();
    let func = new Function('size', 'vx', 'vy', 'vz', 'x', 'y', 'z', 'noise', 'ctx', script);
    let svoxNoise = SVOX.Noise();
    let noise = function(x, y, z) { return svoxNoise.noise(x, y, z) / 2 + 0.5; };
    let voxels = '';
    let ctx = { 
      settings: undefined
    };
    for (let vz = 0; vz<size; vz++) {
      for (let vy = 0; vy<size; vy++) {
        for (let vx = 0; vx<size; vx++) {
            let x = vx + 0.5 - size/2;
            let y = vy + 0.5 - size/2;
            let z = vz + 0.5 - size/2;
            let result = func(size, vx, vy, vz, x, y, z, noise, ctx);

            let color = '-';
            if (typeof result === 'string')
              color = result;
            else if (result >= 1) {
                let d = 0;
                switch(direction) {
                  case 'Up' : d = (y + size/2) / size; break;
                  case 'Down' : d = 1 - (y + size/2) / size; break;
                  case 'Right' : d = (x + size/2) / size; break;
                  case 'Left' : d = 1 - (x + size/2) / size; break;
                  case 'Front' : d = (z + size/2) / size; break;
                  case 'Back' : d = 1 - (z + size/2) / size; break;
                  case 'Out' : d = Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) / (size/2); break;
                  case 'In' : d = 1 - Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) / (size/2); break;
                  case 'X-Out' : d = Math.max(Math.abs(y), Math.abs(z)) / (size/2); break;
                  case 'X-In' : d = 1 - Math.max(Math.abs(y), Math.abs(z)) / (size/2); break;
                  case 'Y-Out' : d = Math.max(Math.abs(x), Math.abs(z)) / (size/2); break;
                  case 'Y-In' : d = 1 - Math.max(Math.abs(x), Math.abs(z)) / (size/2); break;
                  case 'Z-Out' : d = Math.max(Math.abs(x), Math.abs(y)) / (size/2); break;
                  case 'Z-In' : d = 1 - Math.max(Math.abs(x), Math.abs(y)) / (size/2); break;
                }
                color = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[Math.max(Math.min(palette.size-1, Math.floor(palette.size * d)))];
            }
          
            voxels += color;
        }
        voxels += ' ';
      }
      voxels += '\r\n';
    }

    let smooth = document.getElementById('form').value.startsWith('Smooth');
    let ao = document.getElementById('form').value.endsWith('AO');

    if (!ctx.settings) {
      let envMap = '';
      if (palette.material.includes('= env'))
        envMap = 'texture id = env, image = %ENVIRONMENT%\r\n\r\n';
      
      let model = 
        `model\r\n` + 
        `size = ${size}\r\n` + 
        `scale = ${(1/size).toFixed(3)}\r\n` + 
        `shape = box\r\n` + 
        `resize = fit\r\n` + 
        `origin = -y\r\n` + 
        `wireframe = false\r\n` + 
        (ao ? `ao = 5 1\r\n` : ``) +
        `clamp = none\r\n\r\n`;

      let material = palette.material;
      if (smooth) {
        material += ', lighting = smooth, deform = 5';
        if (material.includes('standard') && !material.includes('roughness'))
          material += ', roughness = 0.1, metalness = 0.2';
      }
      else
        material += ', lighting = flat';
      material += '\r\n'; 
      
      let colors = `  colors = ${palette.colors}\r\n\r\n` 

      editor.setValue(envMap + model + material + colors + `voxels\r\n` + voxels, -1);
      editor.gotoLine(1);
    }
    else {
      // The settings (model & materials) are defined in the script itself use those
      editor.setValue(ctx.settings + `\r\n\r\nvoxels\r\n` + voxels, -1);
    }
  }
  catch (exception) {
    document.getElementById('scripterrors').innerHTML = exception.name + ": " + exception.message;
  }
}

/* ------ Loading a Smooth Voxel file ------ */

function loadSvox() {
  const fileUpload = document.createElement('input');
  fileUpload.setAttribute('type', 'file');
  fileUpload.setAttribute('accept', '.svox');
  
  fileUpload.onchange = handleSvoxUpload;
  fileUpload.click();
}

function handleSvoxUpload(e) {
  let file = null;

  if (e.target && e.target.files && e.target.files.length > 0) {
    file = e.target.files[0];
  }
  
  setCurrentName(file.name);

  let reader = new FileReader();

  reader.onload = function() {
    let model = reader.result;
    model = model.replace(/(\r\n|\n)/gm, `\r\n`);
    editor.setValue(model, -1);
    editor.gotoLine(1);
    if (!autoRender)
      renderModel();
  };

  reader.onerror = function() {
    alert(reader.error);
  };

  reader.readAsText(file);
}

/* ------ (Re)loading a MagicaVoxel file ------ */

function reloadMagicaVoxel() {
	let modelString = editor.getValue().trim();
	let model;
  try {        
    if (modelString.length > 0) {
      model = ModelReader.readFromString(modelString);
    }
  }
  catch (ex) {
    SVOX.logError(ex);
    return;
  }
  
  VoxToSvox.reloadMagicaVoxel(handleMagicaVoxelUpload.bind(this, modelString), model);
}

function loadMagicaVoxelFromBuffer(base64) {
  // convert base64 to buffer
  const buffer = new Uint8Array(atob(base64).split("").map(function(c) { return c.charCodeAt(0); }));
  let model;
  try {
    model = VoxToSvox.loadVoxFromBuffer(buffer);
  }
  catch (ex) {
    alert(ex.message + `\r\n\r\nTry saving using the last version of MagicaVoxel.`);
    return;
  }
  
  let modelString = ModelWriter.writeToString(model, false);
  editor.setValue(modelString, -1);
  editor.gotoLine(1);
  if (!autoRender)
    renderModel();
}

function handleMagicaVoxelUpload(modelString, result) {
  if (result.fileName)
    setCurrentName(result.fileName);
  if (result.error)
    alert(result.error)
  if (result.model) {
    if (modelString.length > 0) {
      result.model.prepareForWrite();
      
      // Keep the original model in tact (e.g. for comments indentation etc.)
      const voxelsIndex = modelString.lastIndexOf('voxels');
      modelString = modelString.slice(0, voxelsIndex).trim();

      // Replace the last occurence of [size = n [n] [n] with the new size from the .vox file
      let size = result.model.voxels.size;
      let sizeInModel = new RegExp( `(?<=model[.\\s]*)(size[ \\t]*=([ \\t]*\\d+){1,3})`, 'gmi');
      modelString = modelString.replace(sizeInModel, `size = ${size.x} ${size.y} ${size.z}`);      
      
      // Find the last material, which, if it has colors in it needs to be added
      let newMaterial;
      result.model.materials.forEach(function(material) {
        newMaterial = material;
      }, this);
      if (newMaterial.settings.colors.length > 0) {
        let materialString = MaterialWriter.write(newMaterial);
        modelString += '\r\n\r\n' + materialString;
      }
      
      // Add the voxels
      modelString += '\r\n\r\nvoxels\r\n' + VoxelWriter.writeVoxels(result.model,1, 1);
    }
    else {
      modelString = ModelWriter.writeToString(result.model, false);
    }
    editor.setValue(modelString, -1);
    editor.gotoLine(1);
    if (!autoRender)
      renderModel();    
  }
}

/* ------ Saving a Magica Voxel file ------ */

function saveMagicaVoxel() {
  let modelString = editor.getValue();
  
  let model = ModelReader.readFromString(modelString);
  let buffer = SvoxToVox.saveVoxToBuffer(model);
  
  for (const colorId in model.colors) {
    const color = model.colors[colorId];
    if (Number.isFinite(color.exId)) {
      modelString = modelString.replaceAll(new RegExp('=' + color.id + '[ \t]*:', 'mg'), `= ${color.id}(${color.exId}):`);
      modelString = modelString.replaceAll(new RegExp('[ \t]+' + color.id + '[ \t]*:', 'mg'), ` ${color.id}(${color.exId}):`);
    }
  } 
  editor.setValue(modelString, -1);
  editor.gotoLine(1);
  
  let name = getCurrentName() + '.vox';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([new Uint8Array(buffer)], { type:`application/octet-stream` }) );
  a.download = name;
  a.click();
}

/* ------ Create a model from an image ------ */

function loadImage() {
  const fileUpload = document.createElement('input');
  fileUpload.setAttribute('type', 'file');
  fileUpload.setAttribute('accept', '.png, .jpg, , .jpeg, .gif, .webp');
  
  fileUpload.onchange = handleImageUpload;
  fileUpload.click();
}

function handleImageUpload(e) {
  let file = null;

  if (e.target && e.target.files && e.target.files.length > 0) {
    file = e.target.files[0];
  }

  if (file.type.startsWith('image/')) {
    setCurrentName(file.name);
    
    let img = new Image();

    // All the handling is done in convertImage
    img.onload = convertImage;

    img.onerror = function() {
      alert("The image could not be loaded");
    };

    img.src = URL.createObjectURL(this.files[0]);
  }
  else {
    alert('This image format is not supported.');
  }
};

function convertImage() {
  const uploadCanvas = document.createElement('canvas');
  uploadCanvas.id = "uploadCanvas";
  
  uploadCanvas.width = this.width;
  uploadCanvas.height = this.height;
  let ctx = uploadCanvas.getContext('2d');
  ctx.drawImage(this, 0,0);
  let pixels = ctx.getImageData(0, 0, this.width, this.height); 
  
  let size = Math.max(this.width, this.height);
  
  let scale = Math.round(1/size*10000)/10000
  let model = new Model( { 
    scale: { x: scale, y: 0.1, z: scale },
    origin: "+z",
    rotation: { x:90, y:0, z:0 }
  });
  
  let material = model.materials.createMaterial(model, getCurrentName(), { lighting:SVOX.BOTH, roughness:0.5, metalness:0, fade:true, deform:10, clamp:'y' }, true);

  let pixel = 0;
  let colors = {};
  for (let z=0; z<this.height; z++) {
    for (let x=0; x<this.width; x++) {
      
      // 4096 Colors
      //let col = ((pixels.data[pixel+0]&0xF0)<<5) + ((pixels.data[pixel+1]&0xD0)) + ((pixels.data[pixel+2]&0xF0)>>4);
      
      // 512 Colors
      let col = ((pixels.data[pixel+0]&0xE0)<<4) + ((pixels.data[pixel+1]&0xE0)) + ((pixels.data[pixel+2]&0xE0)>>4);
      
      let hex = '000' + Number(col).toString(16);
      hex = '#' + hex.substr(hex.length - 3, 3);
      
      if (pixels.data[pixel+3] > 0) {
        let color = colors[hex];
        if (!color) {
          color = Color.fromHex(hex);
          colors[hex] = color;
          material.addColor(color);
        }

        model.voxels.setVoxel(x, 0, z, new Voxel(color));
      }
      pixel += 4;
    }
  }

  editor.setValue(ModelWriter.writeToString(model, false), -1);
  editor.gotoLine(1);
  if (!autoRender)
    renderModel();
};

/* ------ Load and image as Heightmap ------ */

function loadHeightmap(gradient) {
  loadHeightmap.gradient = gradient;
  const fileUpload = document.createElement('input');
  fileUpload.setAttribute('type', 'file');
  fileUpload.setAttribute('accept', '.png, .jpg, , .jpeg, .gif, .webp');
  
  fileUpload.onchange = handleHeightmapUpload;
  fileUpload.click();
}

function handleHeightmapUpload(e) {
  let file = null;

  if (e.target && e.target.files && e.target.files.length > 0) {
    file = e.target.files[0];
  }

  if (file.type.startsWith('image/')) {
    setCurrentName(file.name);
    
    let img = new Image();

    // All the handling is done in convertHeightmap
    img.onload = convertHeightMap;

    img.onerror = function() {
      alert("The image could not be loaded");
    };

    img.src = URL.createObjectURL(this.files[0]);
  }
  else {
    alert('This image format is not supported.');
  }
};

function convertHeightMap() {
  const uploadCanvas = document.createElement('canvas');
  uploadCanvas.id = "uploadCanvas";
  
  uploadCanvas.width = this.width;
  uploadCanvas.height = this.height;
  let ctx = uploadCanvas.getContext('2d');
  ctx.drawImage(this, 0,0);
  let pixels = ctx.getImageData(0, 0, this.width, this.height); 
  
  let size = Math.max(this.width, this.height);
  
  let scale = Math.round(1/size*10000)/10000
  let model = new Model( { 
    scale: { x: scale, 
             y: scale, 
             z: scale 
           },
    origin: Planar.parse('-y')
  });

  const LEVELS = loadHeightmap.gradient ? 26 : 64;
  
  // Create the material and a grey scale gradient of 26 colors
  let material = model.materials.createMaterial(model, getCurrentName(), { lighting:SVOX.BOTH, roughness:0.5, metalness:0, fade:loadHeightmap.gradient, deform:15, clamp:'-x +x -y -z +z', skip:'-x +x -y -z +z' }, true);
  if (loadHeightmap.gradient) {
    for (let l=0; l<LEVELS; l++) {
      let col = ('00'+Math.floor(255.999/(LEVELS-1)*l).toString(16)).slice(-2).toUpperCase();
      let color = Color.fromHex(col+col+col);
      color.id = String.fromCharCode(65+l);
      material.addColor(color);
    }  
  } 
  else {
    let color = Color.fromHex('888');
    color.id = 'A';
    material.addColor(color);
  }

  for (let y=0; y<LEVELS; y++) {
    let pixel = 0;
    let color = loadHeightmap.gradient ? material.colors[y] : material.colors[0];
    for (let z=0; z<this.height; z++) {
      for (let x=0; x<this.width; x++) {

        let height = pixels.data[pixel+0]*0.299 +  pixels.data[pixel+1]*0.587 + pixels.data[pixel+2]*0.114;
        height = Math.floor(LEVELS/255.001 * height);
        if (height >= y && pixels.data[pixel+3] > 0) {
          model.voxels.setVoxel(x, y, z, new Voxel(color));
        }
        pixel += 4;
      }
    }
  }

  editor.setValue(ModelWriter.writeToString(model, false), -1);
  editor.gotoLine(1);
  if (!autoRender)
    renderModel();
};

/* ------ Add an image as Base64 ------ */

function addImage() {
  const fileUpload = document.createElement('input');
  fileUpload.setAttribute('type', 'file');
  fileUpload.setAttribute('accept', '.png, .jpg, , .jpeg, .gif, .webp');
  
  fileUpload.onchange = createTexture;
  fileUpload.click();
}

function createTexture(e) {
  let file = null;

  if (e.target && e.target.files && e.target.files.length > 0) {
    file = e.target.files[0];
  }

  let reader = new FileReader();
  reader.readAsDataURL(file);
  reader.onload = function () {

    let img = new Image();
    img.onload = function() {
      editor.setValue( 
            "texture id = " + file.name.substr(0,file.name.indexOf('.')).toLowerCase().replace(/[^0-9a-z]/gi, '') + 
            `, cube = false, size = ${this.width} ${this.height}, borderoffset = 0.5, image = ` + reader.result + "\r\n" +
            editor.getValue(), -1);
      editor.gotoLine(1);
    };
    img.src = reader.result;
  };

  reader.onerror = function (error) {
    console.log('Error: ', error);
  };
}

/* --------- Add Environment -------- */

function addEnvironment(variableOnly) {
  if (variableOnly) {
   // The playground replaces the %ENVIRONMENT%  variable.
  // But the %ENVIRONMENT% in the comment has two invisible spaces to prevent it from being replaced
   editor.setValue( 
         "// %⁠ENVIRONMENT⁠% only works in the Playground!!\r\ntexture id = env, image = %ENVIRONMENT%\r\n" +
         editor.getValue(), -1);
  }
  else {
   editor.setValue( 
         "texture id = env, image = " + 
         environments[sceneEnv].envMapBase64 + "\r\n" +
         editor.getValue(), -1);
  }
  editor.gotoLine(1);  
}

/* ------ Load an Equirectangular Image and convert it to a base 64 Cube map -------- */

function loadToCube() {
  const fileUpload = document.createElement('input');
  fileUpload.setAttribute('type', 'file');
  fileUpload.setAttribute('accept', '.png, .jpg, , .jpeg, .gif, .webp');
  
  fileUpload.onchange = handleToCubeUpload;
  fileUpload.click();
}

function handleToCubeUpload(e) {
  let file = null;

  if (e.target && e.target.files && e.target.files.length > 0) {
    file = e.target.files[0];
  }

  if (file.type.startsWith('image/')) {
    let img = new Image();
    img.fileName = file.name;
    img.fileType = file.name.split('.').pop().toLowerCase();
    if (img.fileType === 'jpg') img.fileType = 'jpeg';

    // All the handling is done in convertImage
    img.onload = convertToCube;

    img.onerror = function() {
      alert("The image could not be loaded");
    };

    img.src = URL.createObjectURL(this.files[0]);
  }
  else {
    alert('This image format is not supported.');
  }
};

function convertToCube() {

  const canvasIn   = document.createElement('canvas');
  let width        = this.width;
  let height       = this.height;

  canvasIn.width   = width;
  canvasIn.height  = height;
  let ctxIn        = canvasIn.getContext('2d');
  ctxIn.drawImage(this, 0,0);
  let imageDataIn  = ctxIn.getImageData(0, 0, width, height); 
  let dataIn       = imageDataIn.data;

  let canvasOut    = document.createElement('canvas');
  canvasOut.width  = width;
  canvasOut.height = height;
  let ctxOut       = canvasOut.getContext('2d');
  let imageDataOut = ctxOut.getImageData(0, 0, width, height); 
  let dataOut      = imageDataOut.data;
  
  let pixel = 0;
  for (let y=-height/4; y<height/4; y++) {
    for (let x=-width/8; x<width/8; x++) {

      // Left
      let xout = width/8*1 + x; let yout = height/4 * 3 + y;
      let xcube = -height/4; let ycube = y; let zcube = x; 
      convertCubePixel(dataIn, dataOut, width, height, xcube, ycube, zcube, xout, yout);
      
      // Front
      xout  = width/8*3 + x; yout = height/4 * 3 + y;
      xcube = x; ycube = y; zcube = height/4; 
      convertCubePixel(dataIn, dataOut, width, height, xcube, ycube, zcube, xout, yout);

      // Right
      xout  = width/8*5 + x; yout = height/4 * 3 + y;
      xcube = height/4; ycube = y; zcube = -x; 
      convertCubePixel(dataIn, dataOut, width, height, xcube, ycube, zcube, xout, yout);

     // Back
      xout  = width/8*7 + x; yout = height/4 * 3 + y;
      xcube = -x; ycube = y; zcube = -height/4; 
      convertCubePixel(dataIn, dataOut, width, height, xcube, ycube, zcube, xout, yout);

      // Top
      xout  = width/8*3 + x; yout = height/4 * 1 + y;
      xcube = x; ycube = -height/4; zcube = y; 
      convertCubePixel(dataIn, dataOut, width, height, xcube, ycube, zcube, xout, yout);

      // Bottom
      xout  = width/8*7 + x; yout = height/4 * 1 + y;
      xcube = x; ycube = height/4; zcube = -y; 
      convertCubePixel(dataIn, dataOut, width, height, xcube, ycube, zcube, xout, yout);
    }
  }
  
  let color1 = fillBorders(dataOut, 0, 0, width, height);
  let color2 = fillBorders(dataOut, width/2, 0, width, height);
  ctxOut.putImageData(imageDataOut, 0, 0);
  
  editor.setValue( 
        "texture id = " + this.fileName.substr(0, this.fileName.indexOf('.')).toLowerCase().replace(/[^0-9a-z]/gi, '') + 
        `, cube = true, size = ${width} ${height}, borderoffset = 0.5, image = ` + canvasOut.toDataURL('image/' + this.fileType, 0.9) + "\r\n" +
        editor.getValue(), -1);
  editor.gotoLine(1);
}

function convertCubePixel(dataIn, dataOut, width, height, xcube, ycube, zcube, xout, yout) {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (let i=-1; i<=1; i+=2) {
    for (let j=-1; j<=1; j+=2) {
      for (let k=-1; k<=1; k+=2) {
        let x = xcube + i/2;
        let y = ycube + j/2;
        let z = zcube + k/2;
        let lon  = -Math.atan2(z, x);
        let lat  = Math.atan2(y, Math.sqrt(x*x + z*z));
        let xin  = Math.floor(lon / Math.PI / 2 * width  + width  / 2) % width;
        let yin  = Math.floor(lat / Math.PI * height + height / 2);

        let pixelIn = (yin*width + xin) * 4;
        r    += dataIn[pixelIn + 0];
        g    += dataIn[pixelIn + 1];
        b    += dataIn[pixelIn + 2];
        a    += dataIn[pixelIn + 3];
      }
    }
  }
  let pixelOut = (yout*width + xout) * 4;
  dataOut[pixelOut + 0] = r/8;
  dataOut[pixelOut + 1] = g/8;
  dataOut[pixelOut + 2] = b/8;
  dataOut[pixelOut + 3] = a/8;
}

function fillBorders(dataOut, x1, y1, width, height) {
  let color = {r:0, g:0, b:0, a:0};
  let count = 0;
  for (let y=y1; y<y1+height/2; y++) {
    for (let x=x1; x<x1+width/4; x++) {
      let dl = Math.abs(x1-x);
      let dt = Math.abs(y1-y);
      let dr = Math.abs(x1+width/4-x);
      let db = Math.abs(y1+height/2-y);

      let xp = x;
      let yp = y;
      if (dl<dt && dl<dr && dl<db) {
        xp = x1-1;
      }
      else if (dt<dr && dt<db) {
        yp = y1-1;
      }
      else if (dr<db) {
        xp = x1+width/4;
      }
      else {
        yp = y1+height/2;
      }
      xp = (xp+width)%width;
      yp = (yp+height)%height;
      
      let pixelFrom = (yp*width + xp) * 4;
      let pixelTo   = ( y*width + x ) * 4;
      dataOut[pixelTo + 0] = dataOut[pixelFrom + 0]; 
      dataOut[pixelTo + 1] = dataOut[pixelFrom + 1]; 
      dataOut[pixelTo + 2] = dataOut[pixelFrom + 2]; 
      dataOut[pixelTo + 3] = dataOut[pixelFrom + 3]; 
      color.r += dataOut[pixelFrom + 0]; 
      color.g += dataOut[pixelFrom + 1]; 
      color.b += dataOut[pixelFrom + 2]; 
      color.a += dataOut[pixelFrom + 3]; 
      count++;
    }
  }
  return { r:Math.round(color.r/count), g:Math.round(color.g/count), b:Math.round(color.b/count), a:color.a/count/255 };
}

/* --------- Compress/Decompress voxels -------- */

function onCompressVoxels() {
  let modelString = editor.getValue().trim() + '\r\n';
  
  // Replace the voxels with properly formatted / decompressed voxels
  let model = ModelReader.readFromString(modelString);
  
  // Replace the last occurence of [size = n [n] [n] with the new size from the .vox file
  // (The size can change when the model is saved with empty sides in its original bounds)
  let size = model.voxels.size;
  let sizeInModel = new RegExp( `(?<=model[.\\s]*)(size[ \\t]*=([ \\t]*\\d+){1,3})`, 'gmi');
  modelString = modelString.replace(sizeInModel, `size = ${size.x} ${size.y} ${size.z}`);  

  // Replace the voxels
  const voxelsIndex = modelString.lastIndexOf('voxels');
  modelString = modelString.slice(0, voxelsIndex).trim();
  modelString += '\r\n\r\nvoxels\r\n' + VoxelWriter.writeVoxelsRLE(model, 100)
  
  editor.setValue(modelString, -1);
}


function onDecompressVoxels() {
  let modelString = editor.getValue().trim() + '\r\n';
  
  // Replace the voxels with properly formatted / decompressed voxels
  let model = ModelReader.readFromString(modelString);
  
  // Replace the last occurence of [size = n [n] [n] with the new size from the .vox file
  // (The size can change when the model is saved with empty sides in its original bounds)
  let size = model.voxels.size;
  let sizeInModel = new RegExp( `(?<=model[.\\s]*)(size[ \\t]*=([ \\t]*\\d+){1,3})`, 'gmi');
  modelString = modelString.replace(sizeInModel, `size = ${size.x} ${size.y} ${size.z}`);  

  // Replace the voxels
  const voxelsIndex = modelString.lastIndexOf('voxels');
  modelString = modelString.slice(0, voxelsIndex).trim();
  modelString += '\r\n\r\nvoxels\r\n' + VoxelWriter.writeVoxels(model, 1, 1);
  
  editor.setValue(modelString, -1);
}

/* --------- Add Code Snippet -------- */

function addSnippet(fullLine, text) {
  if (fullLine) {
    editor.session.insert( { row:editor.getCursorPosition().row, column:0 }, text + (fullLine ? '\r\n' : ''));
  }
  else {
    editor.session.insert(editor.getCursorPosition(), text);    
  }
}

/* ------ SVOX model Saves ------ */

function saveTextAsShown() {
  saveTextFile(editor.getValue().replace(/(\r\n|\n)/gm, `\r\n`), getCurrentName() + '.svox');
}

function saveUncompressed() {
  let model = ModelReader.readFromString(editor.getValue());
  saveTextFile(ModelWriter.writeToString(model, false), getCurrentName() + '.svox');
}

function saveUncompressed2() {
  let model = ModelReader.readFromString(editor.getValue());
  let modelString = ModelWriter.writeToString(model, false);
  
  // Create a blob with the model data
  const blob = new Blob([modelString], { type: 'text/plain' });

  // Create a temporary anchor element to trigger the download
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = getCurrentName() + '.svox';
  anchor.click();
}

function saveCompressed() {
  let model = ModelReader.readFromString(editor.getValue());
  saveTextFile(ModelWriter.writeToString(model, true), getCurrentName() + '.min.svox');
}

function saveAFrameComponent(fullScene, compressed, digits) {
  try {
    let model = ModelReader.readFromString(editor.getValue());
    let svoxmesh = SvoxMeshGenerator.generate(model);
    saveTextFile(SvoxToAFrameConverter.generate(svoxmesh, fullScene, compressed, digits), getCurrentName() + (fullScene ? '.html' :  '.js'));
  }
  catch (ex) {
    SVOX.logError(ex);
  }
}

function saveGltf(binary) {
  try {
    let model = document.getElementById('model');
    if (model) {
      let exporter = new GLTFExporter();
      let exportoptions = {
        binary:binary,
        onlyVisible:true,
        trs:true,
        embedImages:true,
        forcePowerOfTwoTextures:false,
        truncateDrawRange:false,
        forceIndices:true
      };

      // Parse the input and generate the glTF output
      let mesh = model.getObject3D('mesh');
      exporter.parse( mesh, function ( gltf ) {
        if (binary) 
          saveGlbFile( gltf, getCurrentName() + '.glb');
        else
          saveTextFile( JSON.stringify(gltf), getCurrentName() + '.gltf');
      }, exportoptions );
    }
    else {
      alert('No model to export');
    }
  }
  catch (error) {
    alert ('The model could not be exported.\r\n\r\nSee the browser console and the documentation on material types for more information.');
  }
}
 
function saveGlbFile(body, name) {
  const a = document.createElement('a');
  const type = name.split(".").pop();
  a.href = URL.createObjectURL(new Blob([body], { type:`gltf-binary/${type}` }) );
  a.download =  name;
  a.click();
}

function saveTextFile(text, name) {
  const a = document.createElement('a');
  const type = name.split(".").pop();
  a.href = URL.createObjectURL( new Blob([text], { type:`text/${type === "txt" ? "plain" : type}` }) );
  a.download = name;
  a.click();
}

function loadFromClipboard() {
  let model = Clipboard.read(function(model) {
    editor.setValue(model, -1);
    editor.gotoLine(1);
    if (!autoRender)
      renderModel();
  });
}

function saveToClipboard() {
  let model = editor.getValue().replace(/(\r\n|\n)/gm, `\r\n`)
  Clipboard.write(model);
}

function copyViewerUrl() {
  let url = window.location.origin + '/playground.html?';
  url += sceneEnv === 0 ? '' : `v=${sceneEnv}&`;
  url += background ? '' : 'g=0&';
  url += environment ? '' : 'e=0&';
  url += baseVisible ? '' : 'b=0&';
  url += lights ? '' : 'l=0&';
  url += rotateModel ? '' : 'r=0&';
  url += shadow ? '' : 's=0&';
  url += 'f=1&c=1&m=';
  let model = ModelReader.readFromString(editor.getValue());
  let modelstring = ModelWriter.writeToString(model, true);
  url += encodeURIComponent(modelstring);
  Clipboard.write(url);
  if (url.length > 8000)
    alert('\nUrl copied to clipboard.\n\nNote: This viewer url is very large and will likely not work in most browsers!')
  else
    alert('\nUrl copied to clipboard.')
}

function repeatVoxels(repeat) {
  let model = ModelReader.readFromString(editor.getValue());
  model = ModelWriter.writeToString(model, false, repeat);
  editor.setValue(model, -1);
  editor.gotoLine(1);
  if (!autoRender)
    renderModel();  
}

/* ------ Save script ------ */

function saveScript() {
  let sizeText = document.getElementById('size');
  let size = parseInt(Math.min(Math.max(1, sizeText.value),200));
  sizeText.value = size.toString();
  let paletteName = document.getElementById('palettes').value;
  let palette = PALETTES.find(p => p.name === paletteName);  
  let direction = document.getElementById('direction').value;
  let form = document.getElementById('form').value;
  let script = scriptEditor.getValue();
  let settings = `/* size = ${size}, palette = ${paletteName}, ${palette.colors.length>9 ? 'direction = ' + direction + ',': ''} form = ${form} */\r\n`;
  
  saveTextFile(settings + script.replace(/(\r\n|\n)/gm, `\r\n`), getCurrentName() + '.script.svox');
}

/* ------ Loading a script ------ */

function loadScript() {
  const fileUpload = document.createElement('input');
  fileUpload.setAttribute('type', 'file');
  fileUpload.setAttribute('accept', '.script.svox,.txt');
  
  fileUpload.onchange = handleScriptUpload;
  fileUpload.click();
}

function handleScriptUpload(e) {
  let file = null;

  if (e.target && e.target.files && e.target.files.length > 0) {
    file = e.target.files[0];
  }
  
  setCurrentScriptName(file.name);
  setCurrentName(file.name);
  
  let reader = new FileReader();

  reader.onload = function() {
    let script = reader.result;

    // If the first line starts with ''/* size =' split the script first line of as settings
    let settings = script.match(/^\/\*\s*size\s*=.*$/m)?.[0] ?? '';
    settings = settings.replace('/*','').replace('*/','');
    script = script.replace(/^\/\*\s*size\s*=.*$/m, '').trim();

    if (settings) {
      settings = settings.split(',').map(s => s.split('='));
      settings.forEach(function(setting) {
        let name = setting[0].trim();
        let value = setting[1].trim();
        switch(name) {
            case 'size':
              let sizeText = document.getElementById('size');
              sizeText.value = value;
              break;
            case 'palette':
              let paletteDropdown = document.getElementById('palettes');
              paletteDropdown.value = value;
              break;
            case 'direction':
              let directionDropdown = document.getElementById('direction');
              directionDropdown.value = value;
              break;
            case 'form':
              let formDropDown = document.getElementById('form');
              formDropDown.value = value;
              break;
        }
      }, this);
    }
    scriptEditor.setValue(script, -1);
    scriptEditor.gotoLine(1);
      generateModel();
  };

  reader.onerror = function() {
    alert(reader.error);
  };

  reader.readAsText(file);
}

// =====================================================
// /playground/playground-controls.js
// =====================================================

// Copied from: https://glitch.com/edit/#!/a-frame-touch-look-controls
// By: Noam Almosnino
// Based on the A-Frame look-controls

AFRAME.registerComponent('playground-controls', {
  dependencies: ['camera'],

  schema: {
    distance:  { type:'float', default: 1.5 },
    elevation: { type:'float', default: 30  },
    angle:     { type:'float', default: 0  },
  },

  init: function () {
    this.distance = this.data.distance;
    this.elevation = this.data.elevation; 
    this.angle = this.data.angle;         // around Y axise
    this.bindMethods();
    this.addEventListeners();
    this.mouseIsDown = false;
    
    this.el.sceneEl.style.cursor = 'grab';
  },

  update: function (oldData) {
  },

  tick: function (t) {
    this.updateOrientation();
  },

  play: function () {
    this.addEventListeners();
  },

  pause: function () {
    this.removeEventListeners();
  },

  remove: function () {
    this.removeEventListeners();
  },

  bindMethods: function () {
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    this.onMouseWheel = this.onMouseWheel.bind(this);
    this.onAxisMove = this.onAxisMove.bind(this);
    this.onThumbStickMoved = this.onThumbStickMoved.bind(this);    
    this.onTouchStart = this.onTouchStart.bind(this);
    this.onTouchMove = this.onTouchMove.bind(this);
    this.onTouchEnd = this.onTouchEnd.bind(this);
    this.onPointerLockChange = this.onPointerLockChange.bind(this);
    this.onPointerLockError = this.onPointerLockError.bind(this);
  },

  /**
   * Add mouse and touch event listeners to canvas.
   */
  addEventListeners: function () {
    var sceneEl = this.el.sceneEl;
    var canvasEl = sceneEl.canvas;

    // Wait for canvas to load.
    if (!canvasEl) {
      sceneEl.addEventListener('render-target-loaded', this.addEventListeners.bind(this));
      return;
    }

    // Mouse events.
    canvasEl.addEventListener('mousedown', this.onMouseDown, false);
    window.addEventListener('mousemove', this.onMouseMove, false);
    window.addEventListener('mouseup', this.onMouseUp, false);

    canvasEl.addEventListener('wheel', this.onMouseWheel, {passive: true});
    this.el.sceneEl.addEventListener('axismove', this.onAxisMove, false);
    this.el.sceneEl.addEventListener('thumbstickmoved', this.onThumbStickMoved, false);

    // Touch events.
    canvasEl.addEventListener('touchstart', this.onTouchStart, {passive: true});
    window.addEventListener('touchmove', this.onTouchMove, {passive: true});
    window.addEventListener('touchend', this.onTouchEnd, {passive: true});

    // Pointer Lock events.
    if (this.data.pointerLockEnabled) {
      document.addEventListener('pointerlockchange', this.onPointerLockChange, false);
      document.addEventListener('mozpointerlockchange', this.onPointerLockChange, false);
      document.addEventListener('pointerlockerror', this.onPointerLockError, false);
    }
  },

  /**
   * Remove mouse and touch event listeners from canvas.
   */
  removeEventListeners: function () {
    var sceneEl = this.el.sceneEl;
    var canvasEl = sceneEl && sceneEl.canvas;

    if (!canvasEl) { return; }

    // Mouse events.
    canvasEl.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);

    canvasEl.removeEventListener('wheel', this.onMouseWheel);
    this.el.sceneEl.removeEventListener('axismove', this.onAxisMove);
    this.el.sceneEl.removeEventListener('thumbstickmoved', this.onThumbStickMoved);
    

    // Touch events.
    canvasEl.removeEventListener('touchstart', this.onTouchStart);
    window.removeEventListener('touchmove', this.onTouchMove);
    window.removeEventListener('touchend', this.onTouchEnd);

    // Pointer Lock events.
    document.removeEventListener('pointerlockchange', this.onPointerLockChange, false);
    document.removeEventListener('mozpointerlockchange', this.onPointerLockChange, false);
    document.removeEventListener('pointerlockerror', this.onPointerLockError, false);
  },

  /**
   * Update orientation for mobile, mouse drag, and headset.
   */
  updateOrientation: function () {
    this.distance = Math.min(50,Math.max(0.5, this.distance));
    this.elevation = Math.min(89.9,Math.max(-89.9, this.elevation));
    
    let e = this.elevation * Math.PI / 180;
    let a = this.angle * Math.PI / 180;
    
    this.el.object3D.position.set(Math.sin(a) * Math.cos(e) * this.distance, 
                                                Math.sin(e) * this.distance, 
                                  Math.cos(a) * Math.cos(e) * this.distance);
    this.el.object3D.rotation.order = "YXZ";
    this.el.object3D.rotation.set(-e, a, 0);
  },

  /**
   * Translate mouse drag into rotation.
   *
   * Dragging up and down rotates the camera around the X-axis (yaw).
   * Dragging left and right rotates the camera around the Y-axis (pitch).
   */
  onMouseMove: function (event) {
    var previousMouseEvent = this.previousMouseEvent;
    
    if (!this.mouseIsDown) return;

    var movementX;
    var movementY;

     // Calculate delta.
    movementX = event.movementX || event.mozMovementX;
    movementY = event.movementY || event.mozMovementY;
    if (movementX === undefined || movementY === undefined) {
      movementX = event.screenX - previousMouseEvent.screenX;
      movementY = event.screenY - previousMouseEvent.screenY;
    }
    this.previousMouseEvent = event;

    // Calculate rotation.
    //if (AFRAME.utils.device.isMobileVR()) {
      this.angle     -= movementX * 0.5;
      this.elevation += movementY * 0.5;
    //}
  },
  
  onMouseDown: function(evt) {
    this.mouseIsDown = true;
    this.previousMouseEvent = evt;
    this.el.sceneEl.style.cursor = 'grabbing';
  },
  
  onMouseUp: function() {
    this.mouseIsDown = false;
    this.el.sceneEl.style.cursor = 'grab';
  },
  
  /**
   * Register mouse wheel to zoom
   */
  onMouseWheel: function(event) {
    this.distance *= (1 + (event.deltaY / 125)/20);
  },
  
  /**
   * Register axismove to zoom
   */
  onAxisMove: function(event) {
    this.distance *= (1 + event.detail.axis[0] + event.detail.axis[1] + event.detail.axis[2] + event.detail.axis[3]);
  },
  
  /**
   * Register axismove to zoom
   */
  onThumbStickMoved: function(event) {
    this.distance *= (1 + event.detail.x);
  },
  

  /**
   * Register touch down to detect touch drag.
   */
  onTouchStart: function (evt) {
    if (evt.touches.length !== 1) { return; }
    this.touchStart = {
      x: evt.touches[0].pageX,
      y: evt.touches[0].pageY
    };
    this.touchStarted = true;
  },

  /**
   * Translate touch move to Y-axis rotation.
   */
  onTouchMove: function (evt) {
    let canvas = this.el.sceneEl.canvas;

    if (!this.touchStarted) { return; }

    let deltaX = 2 * Math.PI * (evt.touches[0].pageX - this.touchStart.x) / canvas.clientWidth;
    let deltaY = 2 * Math.PI * (evt.touches[0].pageY - this.touchStart.y) / canvas.clientHeight;

    // Calculate rotation.
    this.angle     -= deltaX * 50;
    this.elevation += deltaY * 50;
    this.touchStart = {
      x: evt.touches[0].pageX,
      y: evt.touches[0].pageY
    };
  },
  
  /**
   * Register touch end to detect release of touch drag.
   */
  onTouchEnd: function () {
    this.touchStarted = false;
  },

  /**
   * Update Pointer Lock state.
   */
  onPointerLockChange: function () {
    this.pointerLocked = !!(document.pointerLockElement || document.mozPointerLockElement);
  },

  /**
   * Recover from Pointer Lock error.
   */
  onPointerLockError: function () {
    this.pointerLocked = false;
  },

});

// =====================================================
// /helpers/componenthelper.js
// =====================================================

/* Helper functions */

function render(parent, elTag, elAttributes, elText) {
 
    let element = document.createElement(elTag);
  
    if (elText !== null && elText !== undefined && elText !== '') {
      element.innerHTML += elText;
    }
    
    for (let attrName in elAttributes) {
        element.setAttribute(attrName, elAttributes[attrName]);
    };
 
    if (parent !== undefined) 
      return parent.appendChild(element);
    else
      return element;
}

function renderCopy(parent, elTag, elTemplate, elAttributes) {
    let element = document.createElement(elTag);
    for (let attrName in elTemplate) {
        element.setAttribute(attrName, elTemplate[attrName]);
    };
    for (let attrName in elAttributes) {
        element.setAttribute(attrName, elAttributes[attrName]);
    };

    if (parent !== undefined) 
      return parent.appendChild(element);
    else
      return element;
}


// =====================================================
// /helpers/fps-counter.js
// =====================================================

// Usage: <a-text fps-counter position="0 -0.1 -0.25" width="0.25"></a-text>
// Typically inside the camera entity
// Only value and color text properties are set, rest can be used as usual

AFRAME.registerComponent('fps-counter', {
  schema: {},
  init: function () {
    this.framecount = 0;
    this.lasttime = Math.round((new Date()).getTime());
  },
  update: function () {},
  
  tick: function () {
    this.framecount++;
    let now = Math.round((new Date()).getTime());
    if (now - this.lasttime > 500) {
      let fps = Math.round(1000*this.framecount/(now-this.lasttime));
      
      this.el.setAttribute('value', `${fps}`);
      if (fps < 45) this.el.setAttribute('color', '#FF0000'); 
      else if (fps < 55) this.el.setAttribute('color', '#FF8000');
      else this.el.setAttribute('color', '#00FF00');
      
      this.framecount = 0;
      this.lasttime = now;
    }
  },
  
  remove: function () {},
  pause: function () {},
  play: function () {}
});


// =====================================================
// /playground/svoxtoaframeconverter.js
// =====================================================

class SvoxToAFrameConverter {
  
  static generate(model, fullScene, compressed, digits) {
    
    if (!digits) digits = 4;
    
    let result = ``;
    
    if (fullScene) {
      result += `<!DOCTYPE html>\n`;
      result += `<html>\n`;
      result += `  <head>\n`;
      result += `\n`;
      result += `    <script>\n`;
      result += `        // Uncomment to force the page to HTTPS\n`;
      result += `        // if (location.protocol != 'https:') {\n`;
      result += `        //   location.href = 'https:' + location.href.substring(window.location.protocol.length);\n`;
      result += `        // }\n`;
      result += `    </script>\n`;
      result += `\n`;
      result += `    <!-- Include A-Frame -->\n`;
      result += `    <script src="https://aframe.io/releases/1.5.0/aframe.min.js"></script>\n`;
      result += `\n`;
      result += `    <!-- A-Frame Extras Component which (among other things) allows for the movement in Meta Quest -->\n`;
      result += `    <!-- https://github.com/donmccurdy/aframe-extras -->\n`;
      result += `    <script src="https://cdn.jsdelivr.net/gh/c-frame/aframe-extras@7.2.0/dist/aframe-extras.min.js"></script>\n`;
      result += `\n`;
      result += `    <script>\n`;
      result += `\n`;
      result += `// This scene was generated by https://svox.glitch.me/playground.html\n`;
    }
    else {
      result += `\n`;
      result += `\n`;
      result += `\n`;
      result += `// Aframe component, use in an A-Frame scene as: <a-entity mymodel position="0 1 -2" />\n`;
      result += `// This component was generated by https://svox.glitch.me/playground.html\n`;
    }
    
    result += `// Note that the Smooth Voxels library is not needed since the model was generated to javascript.\n`;
    result += `\n`;
    result += `AFRAME.registerComponent("mymodel", {\n`;
    result += `  schema: {  },\n`;
    result += `  init: function () {\n`;
    result += `    if (!this.init.mesh) {\n`; 
    result += `      // Cache the mesh for reuse\n`;
    result += `      this.init.mesh = this._createMesh();\n`; 
    result += `      this.mesh = this.init.mesh;\n`; 
    result += `    }\n`; 
    result += `    else {\n`; 
    result += `      // If this component is used multiple times, reuse the mesh\n`;
    result += `      this.mesh = new THREE.Mesh(this.init.mesh.geometry, this.init.mesh.material);\n`; 
    result += `    }\n`; 
    result += `    this.el.setObject3D('mesh', this.mesh);\n`;     
    result += `  },\n`;
    result += `\n`;
    result += SvoxToAFrameConverter._createMeshFunction(model, compressed, digits);          
    result += `\n`;
    result += `});\n`;
    
    if (fullScene) {
      result += `\n`;
      result += `    </script>\n`;
      result += `\n`;
      result += `  </head>\n`;
      result += `  <body>\n`;
      result += `\n`;
      result += `    <a-scene id="scene" renderer="colorManagement: ${SVOX.colorManagement ? true : false};">\n`;
      result += `\n`;
      result += `      <a-sky color="#0AF"></a-sky>\n`;
      result += `\n`;
      result += `      <a-entity id="rig" movement-controls="fly: true">\n`;
      result += `        <a-entity position="0 1.6 0" oculus-go-controls camera wasd-controls look-controls="pointerLockEnabled: true;">\n`;
      result += `        </a-entity>\n`;
      result += `      </a-entity>\n`;
      result += `\n`;
      result += `      <a-entity mymodel\n`;
      result += `                position="0 1 -1.5"`;
      result += rotateModel ? `\n                animation="property: rotation; from: 0 360 0; to: 0 0 0; loop: true; dur: 10000; easing:linear;">\n` : `>\n`;
      result += `      </a-entity>\n`;
      result += `\n`;
      result += `    </a-scene>\n`;     
      result += `\n`;
      result += `  </body>\n`;
      result += `\n`;
      result += `  <script>\n`;
      result += `\n`
      result += `    // Set the environment map for standard materials without a specific environment map\n`;
      result += `    let scene = document.getElementById('scene');\n`;
      result += `    let environment = new THREE.TextureLoader().load("data:image/webp;base64,UklGRpoPAABXRUJQVlA4WAoAAAAIAAAA/wAAfwAAVlA4IJ4OAAAQWgCdASoAAYAAPw1wqU2mIyGhKhWcoMYhicAYQN7bKK8HUSzAvG8X4Cy58J7o8PdmivZxP/J5XgELwadt4nCSDXrtf/z0yxQV+XdOnDy0NERIKKdtr17QGhzjBItipGqeGFE3Xp5PKRRF1s4nYOxkST8VaU4NOCcP2vxO+5AlJLRNPFTEz2/QWH35KYojxiMGtrJNyjgvZ3V/hdf9NGc9HX8ZWYRaVDXrNG0iqyNUCt6oK7F6VjwMiChacgEeD2VoJLLCf0lnUYLdC3EtZVPKDdSzod/s1WQ5nseSYuDkpWPm/1necK8Sg5qbKYDLsGVZltqNhQAf36mWGxs9bbCnhEro06OAjL0RM9If7+rVz7Nr6wkdgXjfb2g7i6m2ypWi4nyMiegwH6CJLOlTThxeLkepJieB8Zo5lMXzKb9Q0V0eH4+v3wTEpZe3jNQTrd1qbfaZ/VNq9x7fdYXyZunCmKjXqmtjc0KLcTxFPdTEBJI5U9/K6YCkZiNAQcBvwqY0f9ixq/W9vLt5tNX9MPYMQmgFimHmSDDP704ZDhYDUAKs8nAeWlNsZNBvgNAD1v2bMy9XJGznro7uDc8wGHJm486WWak0vnXlfH75jOtGqi2SQcujTAvmWoLZ2plJQT7d9pBXLTedyn7/ROiuHtd8yrX6sAf+X2+depIUk6UM2WJiMF9RCw+wQK8Flcw/IyF2hFisQmKNfyVBO1G3qJ1vW/3QzFIVCkvqg8ATEZL23hNQsTD5f3rgL+nv2tUNDkvMkht3vapnTh7r6ydPRlxiWNykCnnGs3RNERC1BoY4J8lDSu+6Rtgm2u1D5QrrXgUibsYbxd/3Nz/NST0rISeLOKEIZj5GTa6pUX/fiwTE0z3bSEJ1mUKcOV6Zkt7KZmnKUgTS32Kx9qza1WsBnQ0MU9H+D+U6ooB6YtPGfFp/Vcn7qdj5Pu37/ftofJX9JW1x/SW/c3LXjAAA/iP6DQ++rzy+N/IMTfh3I2bN3+KGpnNYC6DATsrViwqQwyeK1LsswE5nBT40HcLqTbtdzZwfEi8D74rrRuX/27rLRZNEopAPOAXgyHT1hEHFLDEmjTREdiOKE/jGRVGBcuOC1+Swpy5PhSepyZRx+AblWpHsLuExJyayPkcFUV3EtBBozWfrxKKxupbCl5CYMJyhfGt40RyIwVSsFZPGTXMAc9YraZKznAaiqpAKygWt8J21Y5XwBFiGqKCLg3Qu9VU9cMqBh2jXYA5ZO2eR5mYq3ERW7AdbxZ8gS26wZx5U2lejfUSpDrR5q6G1iFMWGBmm12i6BV0K11jFy+sWxCscx+JLKWxszRIqNHt3JX9mdSM/8cj5+Zgr3+BM2HilEpcXOG/duo8iFGyDc82LUN3n+amtX3Rl6nUymNlRjTzqt/nSuzdzyG64MzoiyHbPFJxzxNXOjiIKpRlX78raQVS+GosJXIBa/tLz09e92+rgQa2twveUuNiQgp+LRmpTAJXEIMJm0uJVV1uA8rJ83Sq6/KPSI5OPV/1MJsJ2wzcQEzuDG9qZz4tFJNHZgC8x4Pzt4s8KHRJtpEv41PehUXJD8Gd4LQYx9WhUSDt1Z2CCfNM+5VIEeorZKvCqRTvQLq7Sk7i9vpcoAnh6stQiOSUueRWJM3EBHCtqYTu5869dCzSNG03bEfGMh7fmhe49DQrgajgrCNOxEeavSeAyr7QOL/8oW/WmNchRziLjR0fyHo9Nph2d4AXMTcxBEL49HLU0wH9Z3Sxag0IxSV3P6em2dyB4DUAllWq3ozxO2H1CG0aLl2h7B7GKHz1Qf9wOGi38Exm+2HiOlnPpPaFRgU2Nn7AUzhnJsGkGuHOPJp2xo6+alz5D2UzDxbAf5IHtzuSi74fF0Vpws9mya1hQn8Ena6BL9JUHKeCWKQ1lAlrsCtx285Gtri2wXjrDPXJcOkufNlrwierkmxwie3fD533I1Sud29nqqqMkbdfTjE6RWMwM70V7/D/Nl+TgAgL1kaucodBzA6dszi7a+u3ciriKLbv7YzPU3Ea1lr454aPMrnDM3CxS2zuFGYrlwjhH1XQX0yfGJlR4lEKCcjK+dfvxGTdTal5JPOibFk9hmC5lfpTRkyBLmRtXEuu3SgLvfg+QyyiIAXn990TtnERI20w5TBvlvBeGhoihPjH4O/y1eXAc9gkP1oY99ME6ZOV4MZAADdvpXW5fGGGuO6EyIc46cgW8DEXGg41NS0l6sv7u4qQRzvRWzNFJtDG9AO3grEnVOINB29pF4E9SyZCwn9wYaJCMVMbiEluuN3re645D/9jQCHjKg+rV3e4jMgTDBU3QmTyYM1tZ6u67ZDhv6FKqIhYq5x6L19bZWNhJUDGBddvTWfjCz5GnUVC//+vNMiWeDmioyYFoPG3u5Ss0h34qGTT+lYgWMusOxYB4YYGjDuWNAa5VErKZUMk0lTyoyzkU3FiRjO+Ar1OY4WJg5+pPPJZSLqJ9hNpd8CV1JsQ3KdmI7ikXzda7Hf8Hsr8ZeVLw1rkdJIgTTrtB28c+HORTwtO8k87fDh/6BgsDGx985ZVmrBrNkn19ElXFUtw6o7GQ8GK8PXrXJ4inxXYhn6cjKLjvF86ymEJrxNfc3yN5aaarljpw0wt1tLCLKoZSYiY2n8mMBe91fosY6ro3f4CGX9ShRBO2Ty4yJ05/P3pdcy5Vr97W5ji27Den03j+5La+rOpr+OblCfdT7GCpnQR6Mo89WplJTC/VED57SeflTTMojT1ANMZfOx7R3JwAVGSIhrVXxEU1yNCbAp3bkt5VKlP+hzGlk/+F+ps0BmiTXFkAqerFyN9nDeIdSudVjPAx+lhm36I9wJd0vrHqO1A6qjX3njkAO857+v3T/sX8mj+M5bnJL3Mof6aJFTG0aRDItuIBGMg+RCnjY3fsGhV1297EreCVAeGTc5r+Ij0pzhSObNtKsIOlKkLZ7yTACH3fnOGc4JvnjikknWbGTe5Aqjxzkbn48npBO1gzSdzHivsXP//5tihVktkrNPOVA+UDqGLX7i4mcJMy6hu6FsC9dn4E+3Pb9J/VsXkxiVmgCLCV5xWNrrwq/bxY/XYuTxXZOr+vYiFpfKFsLF+qrMO+f862KftYZ3IAVsnU13uOw0fLnRaB1BlpksOkHQFkDW1CDWSj9p09rEDjyDoChdAO/ZIAYzCkpHrpj8iCT4DaW0a2mcOY0M7K6lUCfIf5VcYBzU5SJc/yBOM0zvkrTu5epH/Fxa+O8vWcDFLS7HuOhayJvQHeGTjiPieBEDK4LiHZpPrk95sTy3sINXj0sVJFdiPBl3QF0frHhi+86oOhL0tnHGv6ri+2CDrZvFY8jghpppMpa3xiZIzVlAYFrRG3Kja1HSSIMSr8EQQKBaO70jTXIOvdtBEi6h6mV3Iw3Bt4Ks/c9jaB9HpKA8mjf4MfkEtLyVTrUku2QwZBd412NAeuyEwS04sglsO/tzE/DT4m7s1DKDG5GuaMcchq61JLG4btVALPvRc7mkUr4tCj406hUtf+in6aMF+D3NpN5728IvW5zbp/O8GieOCThzTYIjGDdP6rU75j1x0X3z14Bfnr0NQr7Um+PUVMTgIS65z+znPx8D+4Ftu8N8Rj/2apFB9QvdUDnSSB2FVdbnxgygIKcBVi2xX7GTZKZqCEvKAZLiQblyyJ7o9oAS5ctvo3FYOe7ZqZThTDUt/oJKxwaaJ6U3QkDjdmrl1hGCqsuEh4C8A8yjLH0hkywndYpjwIe8C0JFzYRCi/+6G8bkL8wk86LVgRbdfkxb4JuKM4Q+laH+VLwoDG4Tv+IZ2lHsL49+DQMoRf+XqLpMj4KivrduIzYgH13F68or0L2PlDT/7b8/eprEUR9M2jSE1b1kY0mGs5fCJFUOhojhu7/DSLbHQBAgtQcmyK1JX4jHJPIBNBnzy0BnruO9LzLCbqxA3v8mUx/5S2zNe7UumXizw+mg+X8P0T0174XVeHJWtVK8qlCZg5fTO8gpVqke//ex71DJZYMIgOXSnODwGK2tZo7cZEsm0+z15JYpXZAjwxGFTrzQmfE76o3MkJrcicOCp61kjBC0vjB0S4Mlrwu2N3xGBpZTCA8GIE01cbh1DXm7yFtnoHDhuIWa0KDp1pEQZOz3A6xwMlgOLzhXUSC5HUpBi6PvqFxsunSqt0P9ccz2WUt5yq5iUB+xTZX5S/oFFWxXMF6zfJSfHVY3gG3pT7fdROIbYzpIM2ak5yMoRUMxWqv+nqAnRsHKXcXsi8nCqZ7D6nT6qood9rMwqCUvS+EGbK+i7TTsIFPHG7q4yY2gJm8sFywJyucPzUTuDkJZ4XSblMxZ1ViM2xlJh+Ntxjj5D08qNUHM5UeTG0uiHQWWlLlu3KQKnNOcuOf5b7aSw8BPe5BAlhfX/et06eIMtWpEsI8Wz6N4pPPkcOSdRnZwii/x0zeiLh5jCojS9qCVNygJiz5sK9birW2AyDZItsLG5SIxhIavnkjd2Fk0XTfgZhWgkIlwJ94mtGlq2GWFEQojelL3uD0xlW7bJARH8b6GMfwzR32JWDpPBt7CSMdo2PvQyd9VpOh494/nNHSjoctlsfJjCqrdxEpES1XvF8RFOQpQfOHmoQ6Hy7Tb/NRKqH5DmyzfftKOLYQjYLcMZhteuyNYzFp1xSW/6q9SkIJnfdRfGIoJBUS8ImHWrPRc8s9S2AnzmIQbaWDJ7GXcZYPz0yZR0XNMg9NNVRUtXVYu8281kQbfifDB0G629THukZq0yFFg80fsJ+DlEvVDBbBKtfaUOLKCVdYBYL1R7T2i4OeAxlt5Dy2sbwroFgaJiPCgJ8S7h4mYbAm5CLKD0aGh73gdXNCElkeEYcBPkeKdBCnVa3lwQGbfZWSfGgSokXK//bXYjjjI1gKxADTfFekia/Ze905x/oEKF4ARStr/zXw6tyc2aRXKvJVvBS2/ktgCBfyoOSWp/HMhksOL5z9OuDBLKfUks+QSGdUFwyAAAARVhJRtYAAABJSSoACAAAAAYAEgEDAAEAAAABAAAAGgEFAAEAAABWAAAAGwEFAAEAAABeAAAAKAEDAAEAAAACAAAAMQECABAAAABmAAAAaYcEAAEAAAB2AAAAAAAAAGAAAAABAAAAYAAAAAEAAABwYWludC5uZXQgNS4wLjkABQAAkAcABAAAADAyMzABoAMAAQAAAAEAAAACoAQAAQAAAAABAAADoAQAAQAAAIAAAAAFoAQAAQAAALgAAAAAAAAAAgABAAIABAAAAFI5OAACAAcABAAAADAxMDAAAAAA");\n`;
      result += `    environment.colorSpace = THREE.SRGBColorSpace;\n`;
      result += `    environment.mapping = THREE.EquirectangularReflectionMapping;\n`;
      result += `    scene.object3D.environment = environment;\n`;
      result += `\n`
      result += `  </script>\n`
      result += `\n`;
      result += `</html>\n`;
    }
    
    return result;
    
  }
  
  static _createMeshFunction(model, compressed, digits) {
    
    let result  = `  _createMesh: function() {\n`;
    result     += `    let materials = [];\n`;   
    result += `\n`;
    model.materials.forEach(function(material) {
      result += `${SvoxToAFrameConverter._generateMaterial(material)}`;
    }, this);
    
    result += `    let geometry = new THREE.BufferGeometry();\n`;
    result += `\n`;
    
    let coldigits = Math.min(3, Math.max(2,digits));
    
    if (compressed) {
      result += `    let decompress = function(c){let d=[],i=0,s,l;while(i<c.length)if(c[i]===undefined){s=d.length-c[i+1],l=c[i+2];i+=3;while(l-->0)d.push(d[s++])}else d.push(c[i++]);return d};\n`;
      result += `    let undiff = function(a){for(let i=1;i<a.length;i++)a[i]=a[i-1]+a[i];return a};\n`
      result += `\n`;
      result += `    // Set the geometry attribute buffers\n`;
      result += `    geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( decompress([ ${this._compress(Array.from(model.positions).map(f => this._toString(f, digits)))} ]), 3) );\n`;
      result += `    geometry.setAttribute( 'normal',   new THREE.Float32BufferAttribute( decompress([ ${this._compress(Array.from(model.normals).map(f => this._toString(f, digits)))  } ]), 3) );\n`;
      result += `    geometry.setAttribute( 'color',    new THREE.Float32BufferAttribute( decompress([ ${this._compress(Array.from(model.colors).map(f => this._toString(f, coldigits)))} ]), 3) );\n`;
      if (model.uvs) {
        result += `    geometry.setAttribute( 'uv',       new THREE.Float32BufferAttribute( [ ${Array.from(model.uvs).map(f => f === undefined ? "" : this._toString(f, digits))} ], 2) );\n`;
        result += `    geometry.uvsNeedUpdate = true;\n`;    
      }
      if (model.data) {
        for (let d=0; d<model.data.length; d++) {
          result += `    geometry.setAttribute( '${model.data[d].name}', new THREE.Float32BufferAttribute( decompress([ ${this._compress(model.data[d].values).map(f => this._toString(f))} ]), ${model.data[d].width }) );\n`;
        }      
      }
      result += `    geometry.setIndex( undiff( decompress([ ${this._compress(this._diffEncode(Array.from(model.indices)))} ])));\n`;
    }
    else {
      result += `    // Set the geometry attribute buffers\n`;
      result += `    geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( [ ${Array.from(model.positions).map(f => this._toString(f, digits))} ], 3) );\n`;
      result += `    geometry.setAttribute( 'normal',   new THREE.Float32BufferAttribute( [ ${Array.from(model.normals).map(f => this._toString(f, digits))  } ], 3) );\n`;
      result += `    geometry.setAttribute( 'color',    new THREE.Float32BufferAttribute( [ ${Array.from(model.colors).map(f => this._toString(f, coldigits))} ], 3) );\n`;
      if (model.uvs) {
        result += `    geometry.setAttribute( 'uv',       new THREE.Float32BufferAttribute( [ ${Array.from(model.uvs).map(f => f === undefined ? "" : this._toString(f, 4))} ], 2) );\n`;
        result += `    geometry.uvsNeedUpdate = true;\n`;    
      }
      if (model.data) {
        for (let d=0; d<model.data.length; d++) {
          result += `    geometry.setAttribute( '${model.data[d].name}', new THREE.Float32BufferAttribute( [ ${Array.from(model.data[d].values).map(f => this._toString(f, digits))} ], ${model.data[d].width }) );\n`;
        }      
      }
      result += `    geometry.setIndex( [ ${model.indices} ] );\n`;
    }
      
    result += `\n`;
    result += `    // Add the groups for each material\n`;
    model.groups.forEach(function(group) {
      result += `    geometry.addGroup(${group.start}, ${group.count}, ${group.materialIndex});\n`; 
    }, this);
    
    result += `\n`;
    result += `    geometry.computeBoundingBox();\n`;

    result += `\n`;
    result += `    return new THREE.Mesh(geometry, materials);\n`;  
    result += `  }\n`;  
    
    return result;
  }
  
  // Compress by previous lookup, similar to LZ compression.
  static _compress(array) {
    let startPositions = {};
    let compressed = [];
    let compressedIndex = 0;
    for(let i=0; i<array.length;i++) {
      let bestStart  = 0;
      let bestLength = 0;
      let starts = startPositions[array[i]];
      if (starts === undefined) {
        startPositions[array[i]] = [ ];
      }
      else {
        for (let j=0;j<starts.length;j++) {
          let start  = starts[j];
          let length = 1
          while (i+length < array.length && array[start+length] === array[i+length]) {
            length++;
          }
          if (length >= bestLength && length > 3) {
            bestStart = start;
            bestLength = length;            
          }
        }
      }
      if (bestLength) {
        for (let k = i; k<i+bestLength; k++)
          startPositions[array[k]].push(k);
        compressed[compressedIndex++] = undefined; // Pattern marker
        compressed[compressedIndex++] = i - bestStart;
        compressed[compressedIndex++] = bestLength;
        i += bestLength - 1;
      }
      else {
        startPositions[array[i]].push(i);          
        compressed[compressedIndex++] = array[i];
      }
    }
    return compressed;
  }
  
  // Convert the indices by storing the differences between subsequent values making it much better to compress
  static _diffEncode(array) {
    let lastValue = array[0];
    for (let i = 1; i<array.length; i++) {
      let value = array[i];
      array[i] = value - lastValue;
      lastValue = value;
    }
    return array;
  }
  
  static _undiff(array) {
    for (let i = 1; i<array.length; i++) {
      array[i] = array[i-1] + array[i];
    }
  }

  static _toString(value, digits) {
    if (value === undefined)
      return undefined;
    
    let str = value.toFixed(digits);
    
    // Remove trailing zero's
    while (str.substr(str.length-1) === '0')
      str = str.substr(0, str.length-1);

    // Remove leading 0
    if (str.substring(0, 2) === '0.')
      str = str.substr(1);
    if (str.substring(0, 3) === '-0.')
      str = "-" + str.substr(2);
    
    if (str === "." || str === "-.")
      str = "0";
    
    if (str.endsWith('.'))
      str = str.slice(0,-1);
    
    return str;
  }

  static _generateMaterial(definition) {

    let result = `    materials.push(new THREE.Mesh` + definition.type[0].toUpperCase() + definition.type.substring(1) + `Material({\n`;
    for (const property in definition) {
      let value = definition[property];
      if (value === undefined || property === 'type' || property === 'map' || property === 'matcap' ||property.endsWith('Map'))
        continue;
      
      switch (property) {
        case 'normalScale':
        case 'clearcoatNormalScale': 
          result+= `      ${property}: new THREE.Vector2(${value.x}, ${value.y}),\n`; break;
        case 'side': 
          result+= `      ${property}: THREE.${value[0].toUpperCase() + value.substring(1)}Side,\n`; break;
        case 'blending': 
          result+= `      ${property}: THREE.${value[0].toUpperCase() + value.substring(1)}Blending,\n`; break;
        case 'combine': 
          result+= `      ${property}: THREE.${value[0].toUpperCase() + value.substring(1)}Operation,\n`; break;
        case 'color': 
        case 'emissive':
        case 'specular': 
        case 'specularColor':
        case 'attenuationColor': 
          result+= `      ${property}: new THREE.Color(${value.r}, ${value.g}, ${value.b}),\n`; break;

        // For all other properties, just write the value toString
        default: result+= `      ${property}: ${value},\n`; break;
      }
    }
    
    // Color space according to https://threejs.org/docs/#manual/en/introduction/Color-management
    for (const property in definition) {
      let map = definition[property];
      if (map === undefined) 
        continue;
      
      switch (property) {
        case 'envMap': {
          if (definition.ior !== undefined || definition.refractionRatio !== undefined)
            result += `      ${property}: ${SvoxToAFrameConverter._generateEnvMap(map.image, true)},\n\n`;
          else
            result += `      ${property}: ${SvoxToAFrameConverter._generateEnvMap(map.image, false)},\n\n`;
          break;
        }
        case 'matcap': {
          result += `      ${property}: ${SvoxToAFrameConverter._generateTexture(map.image, true)},\n\n`;
          break;
        }
        case 'map':
        case 'emissiveMap':
        case 'specularColorMap': {
          // For color maps use SRGBColorSpace
          result += `      ${property}: ${SvoxToAFrameConverter._generateTexture(map.image, true, map.uscale, map.vscale,
                                                                                 map.uoffset, map.voffset, map.rotation)},\n\n`;
          break;
        }
        default: {
          if (property.endsWith('Map')) {
            // All other maps use LinearSRGBColorSpace
            result += `      ${property}: ${SvoxToAFrameConverter._generateTexture(map.image, false, map.uscale, map.vscale,
                                                                                   map.uoffset, map.voffset, map.rotation)},\n\n`;
          }
          break;
        }
      }    
    }
    
    result += `\n`;
    
    result = result.substring(0, result.lastIndexOf(',')) + `\n`;
    result += `    }));\n\n`;
    
    return result;
  }
  
  static _generateTexture(image, rgb, uscale, vscale, uoffset, voffset, rotation) { 
    let result = `(function() {\n`;
    result    += `        let texture = new THREE.TextureLoader().load( "${image}" );\n`;
    if (rgb)
      result  += `        texture.colorSpace = THREE.SRGBColorSpace\n`;
    else
      result  += `        texture.colorSpace = THREE.LinearSRGBColorSpace\n`;
    result    += `        texture.repeat.set(${1 / (uscale||1)}, ${1 / (vscale||1)});\n`;
    result    += `        texture.wrapS = THREE.RepeatWrapping;\n`;
    result    += `        texture.wrapT = THREE.RepeatWrapping;\n`;
    result    += `        texture.offset = new THREE.Vector2(${uoffset||0}, ${voffset||0});\n`;
    result    += `        texture.rotation = ${rotation} * Math.PI / 180;\n`;
    result    += `        return texture;\n`;
    result    += `      })()`;
    return result;
  }
  
  static _generateEnvMap(image, refraction) { 
    let result = `(function() {\n`;
    result    += `        let texture = new THREE.TextureLoader().load( "${image}" );\n`;
    result    += `        texture.colorSpace = THREE.SRGBColorSpace;\n`;
    if (refraction) {
      result  += `        texture.mapping = THREE.EquirectangularRefractionMapping\n`;
      result  += `        texture.refractionRatio = 0.5\n`;   // TODO: SHOULD NOT BE FIXED!
    }
    else
      result  += `        texture.mapping = THREE.EquirectangularReflectionMapping\n`;
    result    += `        return texture;\n`;
    result    += `      })()`;
    return result;
  }  
  
}

// =====================================================
// /playground/gltfexporter.js
// =====================================================

class GLTFExporter {

	constructor() {

		this.pluginCallbacks = [];

		this.register( function ( writer ) {

			return new GLTFLightExtension( writer );

		} );

		this.register( function ( writer ) {

			return new GLTFMaterialsUnlitExtension( writer );

		} );

		this.register( function ( writer ) {

			return new GLTFMaterialsPBRSpecularGlossiness( writer );

		} );

		this.register( function ( writer ) {

			return new GLTFMaterialsTransmissionExtension( writer );

		} );

		this.register( function ( writer ) {

			return new GLTFMaterialsVolumeExtension( writer );

		} );

		this.register( function ( writer ) {

			return new GLTFMaterialsClearcoatExtension( writer );

		} );

	}

	register( callback ) {

		if ( this.pluginCallbacks.indexOf( callback ) === - 1 ) {

			this.pluginCallbacks.push( callback );

		}

		return this;

	}

	unregister( callback ) {

		if ( this.pluginCallbacks.indexOf( callback ) !== - 1 ) {

			this.pluginCallbacks.splice( this.pluginCallbacks.indexOf( callback ), 1 );

		}

		return this;

	}

	/**
	 * Parse scenes and generate GLTF output
	 * @param  {Scene or [THREE.Scenes]} input   Scene or Array of THREE.Scenes
	 * @param  {Function} onDone  Callback on completed
	 * @param  {Object} options options
	 */
	parse( input, onDone, options ) {

		const writer = new GLTFWriter();
		const plugins = [];

		for ( let i = 0, il = this.pluginCallbacks.length; i < il; i ++ ) {

			plugins.push( this.pluginCallbacks[ i ]( writer ) );

		}

		writer.setPlugins( plugins );
		writer.write( input, onDone, options );

	}

	parseAsync( input, options ) {

		const scope = this;

		return new Promise( function ( resolve, reject ) {

			try {

				scope.parse( input, resolve, options );

			} catch ( e ) {

				reject( e );

			}

		} );

	}

}

//------------------------------------------------------------------------------
// Constants
//------------------------------------------------------------------------------

const WEBGL_CONSTANTS = {
	POINTS: 0x0000,
	LINES: 0x0001,
	LINE_LOOP: 0x0002,
	LINE_STRIP: 0x0003,
	TRIANGLES: 0x0004,
	TRIANGLE_STRIP: 0x0005,
	TRIANGLE_FAN: 0x0006,

	UNSIGNED_BYTE: 0x1401,
	UNSIGNED_SHORT: 0x1403,
	FLOAT: 0x1406,
	UNSIGNED_INT: 0x1405,
	ARRAY_BUFFER: 0x8892,
	ELEMENT_ARRAY_BUFFER: 0x8893,

	NEAREST: 0x2600,
	LINEAR: 0x2601,
	NEAREST_MIPMAP_NEAREST: 0x2700,
	LINEAR_MIPMAP_NEAREST: 0x2701,
	NEAREST_MIPMAP_LINEAR: 0x2702,
	LINEAR_MIPMAP_LINEAR: 0x2703,

	CLAMP_TO_EDGE: 33071,
	MIRRORED_REPEAT: 33648,
	REPEAT: 10497
};

const THREE_TO_WEBGL = {};

THREE_TO_WEBGL[ THREE.NearestFilter ] = WEBGL_CONSTANTS.NEAREST;
THREE_TO_WEBGL[ THREE.NearestMipmapNearestFilter ] = WEBGL_CONSTANTS.NEAREST_MIPMAP_NEAREST;
THREE_TO_WEBGL[ THREE.NearestMipmapLinearFilter ] = WEBGL_CONSTANTS.NEAREST_MIPMAP_LINEAR;
THREE_TO_WEBGL[ THREE.LinearFilter ] = WEBGL_CONSTANTS.LINEAR;
THREE_TO_WEBGL[ THREE.LinearMipmapNearestFilter ] = WEBGL_CONSTANTS.LINEAR_MIPMAP_NEAREST;
THREE_TO_WEBGL[ THREE.LinearMipmapLinearFilter ] = WEBGL_CONSTANTS.LINEAR_MIPMAP_LINEAR;

THREE_TO_WEBGL[ THREE.ClampToEdgeWrapping ] = WEBGL_CONSTANTS.CLAMP_TO_EDGE;
THREE_TO_WEBGL[ THREE.RepeatWrapping ] = WEBGL_CONSTANTS.REPEAT;
THREE_TO_WEBGL[ THREE.MirroredRepeatWrapping ] = WEBGL_CONSTANTS.MIRRORED_REPEAT;

const PATH_PROPERTIES = {
	scale: 'scale',
	position: 'translation',
	quaternion: 'rotation',
	morphTargetInfluences: 'weights'
};

// GLB constants
// https://github.com/KhronosGroup/glTF/blob/master/specification/2.0/README.md#glb-file-format-specification

const GLB_HEADER_BYTES = 12;
const GLB_HEADER_MAGIC = 0x46546C67;
const GLB_VERSION = 2;

const GLB_CHUNK_PREFIX_BYTES = 8;
const GLB_CHUNK_TYPE_JSON = 0x4E4F534A;
const GLB_CHUNK_TYPE_BIN = 0x004E4942;

//------------------------------------------------------------------------------
// Utility functions
//------------------------------------------------------------------------------

/**
 * Compare two arrays
 * @param  {Array} array1 Array 1 to compare
 * @param  {Array} array2 Array 2 to compare
 * @return {Boolean}        Returns true if both arrays are equal
 */
function equalArray( array1, array2 ) {

	return ( array1.length === array2.length ) && array1.every( function ( element, index ) {

		return element === array2[ index ];

	} );

}

/**
 * Converts a string to an ArrayBuffer.
 * @param  {string} text
 * @return {ArrayBuffer}
 */
function stringToArrayBuffer( text ) {

	if ( window.TextEncoder !== undefined ) {

		return new TextEncoder().encode( text ).buffer;

	}

	const array = new Uint8Array( new ArrayBuffer( text.length ) );

	for ( let i = 0, il = text.length; i < il; i ++ ) {

		const value = text.charCodeAt( i );

		// Replacing multi-byte character with space(0x20).
		array[ i ] = value > 0xFF ? 0x20 : value;

	}

	return array.buffer;

}

/**
 * Is identity matrix
 *
 * @param {Matrix4} matrix
 * @returns {Boolean} Returns true, if parameter is identity matrix
 */
function isIdentityMatrix( matrix ) {

	return equalArray( matrix.elements, [ 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 ] );

}

/**
 * Get the min and max vectors from the given attribute
 * @param  {BufferAttribute} attribute Attribute to find the min/max in range from start to start + count
 * @param  {Integer} start
 * @param  {Integer} count
 * @return {Object} Object containing the `min` and `max` values (As an array of attribute.itemSize components)
 */
function getMinMax( attribute, start, count ) {

	const output = {

		min: new Array( attribute.itemSize ).fill( Number.POSITIVE_INFINITY ),
		max: new Array( attribute.itemSize ).fill( Number.NEGATIVE_INFINITY )

	};

	for ( let i = start; i < start + count; i ++ ) {

		for ( let a = 0; a < attribute.itemSize; a ++ ) {

			let value;

			if ( attribute.itemSize > 4 ) {

				 // no support for interleaved data for itemSize > 4

				value = attribute.array[ i * attribute.itemSize + a ];

			} else {

				if ( a === 0 ) value = attribute.getX( i );
				else if ( a === 1 ) value = attribute.getY( i );
				else if ( a === 2 ) value = attribute.getZ( i );
				else if ( a === 3 ) value = attribute.getW( i );

			}

			output.min[ a ] = Math.min( output.min[ a ], value );
			output.max[ a ] = Math.max( output.max[ a ], value );

		}

	}

	return output;

}

/**
 * Get the required size + padding for a buffer, rounded to the next 4-byte boundary.
 * https://github.com/KhronosGroup/glTF/tree/master/specification/2.0#data-alignment
 *
 * @param {Integer} bufferSize The size the original buffer.
 * @returns {Integer} new buffer size with required padding.
 *
 */
function getPaddedBufferSize( bufferSize ) {

	return Math.ceil( bufferSize / 4 ) * 4;

}

/**
 * Returns a buffer aligned to 4-byte boundary.
 *
 * @param {ArrayBuffer} arrayBuffer Buffer to pad
 * @param {Integer} paddingByte (Optional)
 * @returns {ArrayBuffer} The same buffer if it's already aligned to 4-byte boundary or a new buffer
 */
function getPaddedArrayBuffer( arrayBuffer, paddingByte = 0 ) {

	const paddedLength = getPaddedBufferSize( arrayBuffer.byteLength );

	if ( paddedLength !== arrayBuffer.byteLength ) {

		const array = new Uint8Array( paddedLength );
		array.set( new Uint8Array( arrayBuffer ) );

		if ( paddingByte !== 0 ) {

			for ( let i = arrayBuffer.byteLength; i < paddedLength; i ++ ) {

				array[ i ] = paddingByte;

			}

		}

		return array.buffer;

	}

	return arrayBuffer;

}

let cachedCanvas = null;

/**
 * Writer
 */
class GLTFWriter {

	constructor() {

		this.plugins = [];

		this.options = {};
		this.pending = [];
		this.buffers = [];

		this.byteOffset = 0;
		this.buffers = [];
		this.nodeMap = new Map();
		this.skins = [];
		this.extensionsUsed = {};

		this.uids = new Map();
		this.uid = 0;

		this.json = {
			asset: {
				version: '2.0',
				generator: 'THREE.GLTFExporter'
			}
		};

		this.cache = {
			meshes: new Map(),
			attributes: new Map(),
			attributesNormalized: new Map(),
			materials: new Map(),
			textures: new Map(),
			images: new Map()
		};

	}

	setPlugins( plugins ) {

		this.plugins = plugins;

	}

	/**
	 * Parse scenes and generate GLTF output
	 * @param  {Scene or [THREE.Scenes]} input   Scene or Array of THREE.Scenes
	 * @param  {Function} onDone  Callback on completed
	 * @param  {Object} options options
	 */
	write( input, onDone, options ) {

		this.options = Object.assign( {}, {
			// default options
			binary: false,
			trs: false,
			onlyVisible: true,
			truncateDrawRange: true,
			embedImages: true,
			maxTextureSize: Infinity,
			animations: [],
			includeCustomExtensions: false
		}, options );

		if ( this.options.animations.length > 0 ) {

			// Only TRS properties, and not matrices, may be targeted by animation.
			this.options.trs = true;

		}

		this.processInput( input );

		const writer = this;

		Promise.all( this.pending ).then( function () {

			const buffers = writer.buffers;
			const json = writer.json;
			const options = writer.options;
			const extensionsUsed = writer.extensionsUsed;

			// Merge buffers.
			const blob = new Blob( buffers, { type: 'application/octet-stream' } );

			// Declare extensions.
			const extensionsUsedList = Object.keys( extensionsUsed );

			if ( extensionsUsedList.length > 0 ) json.extensionsUsed = extensionsUsedList;

			// Update bytelength of the single buffer.
			if ( json.buffers && json.buffers.length > 0 ) json.buffers[ 0 ].byteLength = blob.size;

			if ( options.binary === true ) {

				// https://github.com/KhronosGroup/glTF/blob/master/specification/2.0/README.md#glb-file-format-specification

				const reader = new window.FileReader();
				reader.readAsArrayBuffer( blob );
				reader.onloadend = function () {

					// Binary chunk.
					const binaryChunk = getPaddedArrayBuffer( reader.result );
					const binaryChunkPrefix = new DataView( new ArrayBuffer( GLB_CHUNK_PREFIX_BYTES ) );
					binaryChunkPrefix.setUint32( 0, binaryChunk.byteLength, true );
					binaryChunkPrefix.setUint32( 4, GLB_CHUNK_TYPE_BIN, true );

					// JSON chunk.
					const jsonChunk = getPaddedArrayBuffer( stringToArrayBuffer( JSON.stringify( json ) ), 0x20 );
					const jsonChunkPrefix = new DataView( new ArrayBuffer( GLB_CHUNK_PREFIX_BYTES ) );
					jsonChunkPrefix.setUint32( 0, jsonChunk.byteLength, true );
					jsonChunkPrefix.setUint32( 4, GLB_CHUNK_TYPE_JSON, true );

					// GLB header.
					const header = new ArrayBuffer( GLB_HEADER_BYTES );
					const headerView = new DataView( header );
					headerView.setUint32( 0, GLB_HEADER_MAGIC, true );
					headerView.setUint32( 4, GLB_VERSION, true );
					const totalByteLength = GLB_HEADER_BYTES
						+ jsonChunkPrefix.byteLength + jsonChunk.byteLength
						+ binaryChunkPrefix.byteLength + binaryChunk.byteLength;
					headerView.setUint32( 8, totalByteLength, true );

					const glbBlob = new Blob( [
						header,
						jsonChunkPrefix,
						jsonChunk,
						binaryChunkPrefix,
						binaryChunk
					], { type: 'application/octet-stream' } );

					const glbReader = new window.FileReader();
					glbReader.readAsArrayBuffer( glbBlob );
					glbReader.onloadend = function () {

						onDone( glbReader.result );

					};

				};

			} else {

				if ( json.buffers && json.buffers.length > 0 ) {

					const reader = new window.FileReader();
					reader.readAsDataURL( blob );
					reader.onloadend = function () {

						const base64data = reader.result;
						json.buffers[ 0 ].uri = base64data;
						onDone( json );

					};

				} else {

					onDone( json );

				}

			}

		} );

	}

	/**
	 * Serializes a userData.
	 *
	 * @param {THREE.Object3D|THREE.Material} object
	 * @param {Object} objectDef
	 */
	serializeUserData( object, objectDef ) {

		if ( Object.keys( object.userData ).length === 0 ) return;

		const options = this.options;
		const extensionsUsed = this.extensionsUsed;

		try {

			const json = JSON.parse( JSON.stringify( object.userData ) );

			if ( options.includeCustomExtensions && json.gltfExtensions ) {

				if ( objectDef.extensions === undefined ) objectDef.extensions = {};

				for ( const extensionName in json.gltfExtensions ) {

					objectDef.extensions[ extensionName ] = json.gltfExtensions[ extensionName ];
					extensionsUsed[ extensionName ] = true;

				}

				delete json.gltfExtensions;

			}

			if ( Object.keys( json ).length > 0 ) objectDef.extras = json;

		} catch ( error ) {

			console.warn( 'THREE.GLTFExporter: userData of \'' + object.name + '\' ' +
				'won\'t be serialized because of JSON.stringify error - ' + error.message );

		}

	}

	/**
	 * Assign and return a temporal unique id for an object
	 * especially which doesn't have .uuid
	 * @param  {Object} object
	 * @return {Integer}
	 */
	getUID( object ) {

		if ( ! this.uids.has( object ) ) this.uids.set( object, this.uid ++ );

		return this.uids.get( object );

	}

	/**
	 * Checks if normal attribute values are normalized.
	 *
	 * @param {BufferAttribute} normal
	 * @returns {Boolean}
	 */
	isNormalizedNormalAttribute( normal ) {

		const cache = this.cache;

		if ( cache.attributesNormalized.has( normal ) ) return false;

		const v = new THREE.Vector3();

		for ( let i = 0, il = normal.count; i < il; i ++ ) {

			// 0.0005 is from glTF-validator
			if ( Math.abs( v.fromBufferAttribute( normal, i ).length() - 1.0 ) > 0.0005 ) return false;

		}

		return true;

	}

	/**
	 * Creates normalized normal buffer attribute.
	 *
	 * @param {BufferAttribute} normal
	 * @returns {BufferAttribute}
	 *
	 */
	createNormalizedNormalAttribute( normal ) {

		const cache = this.cache;

		if ( cache.attributesNormalized.has( normal ) )	return cache.attributesNormalized.get( normal );

		const attribute = normal.clone();
		const v = new THREE.Vector3();

		for ( let i = 0, il = attribute.count; i < il; i ++ ) {

			v.fromBufferAttribute( attribute, i );

			if ( v.x === 0 && v.y === 0 && v.z === 0 ) {

				// if values can't be normalized set (1, 0, 0)
				v.setX( 1.0 );

			} else {

				v.normalize();

			}

			attribute.setXYZ( i, v.x, v.y, v.z );

		}

		cache.attributesNormalized.set( normal, attribute );

		return attribute;

	}

	/**
	 * Applies a texture transform, if present, to the map definition. Requires
	 * the KHR_texture_transform extension.
	 *
	 * @param {Object} mapDef
	 * @param {THREE.Texture} texture
	 */
	applyTextureTransform( mapDef, texture ) {

		let didTransform = false;
		const transformDef = {};

		if ( texture.offset.x !== 0 || texture.offset.y !== 0 ) {

			transformDef.offset = texture.offset.toArray();
			didTransform = true;

		}

		if ( texture.rotation !== 0 ) {

			transformDef.rotation = texture.rotation;
			didTransform = true;

		}

		if ( texture.repeat.x !== 1 || texture.repeat.y !== 1 ) {

			transformDef.scale = texture.repeat.toArray();
			didTransform = true;

		}

		if ( didTransform ) {

			mapDef.extensions = mapDef.extensions || {};
			mapDef.extensions[ 'KHR_texture_transform' ] = transformDef;
			this.extensionsUsed[ 'KHR_texture_transform' ] = true;

		}

	}

	/**
	 * Process a buffer to append to the default one.
	 * @param  {ArrayBuffer} buffer
	 * @return {Integer}
	 */
	processBuffer( buffer ) {

		const json = this.json;
		const buffers = this.buffers;

		if ( ! json.buffers ) json.buffers = [ { byteLength: 0 } ];

		// All buffers are merged before export.
		buffers.push( buffer );

		return 0;

	}

	/**
	 * Process and generate a BufferView
	 * @param  {BufferAttribute} attribute
	 * @param  {number} componentType
	 * @param  {number} start
	 * @param  {number} count
	 * @param  {number} target (Optional) Target usage of the BufferView
	 * @return {Object}
	 */
	processBufferView( attribute, componentType, start, count, target ) {

		const json = this.json;

		if ( ! json.bufferViews ) json.bufferViews = [];

		// Create a new dataview and dump the attribute's array into it

		let componentSize;

		if ( componentType === WEBGL_CONSTANTS.UNSIGNED_BYTE ) {

			componentSize = 1;

		} else if ( componentType === WEBGL_CONSTANTS.UNSIGNED_SHORT ) {

			componentSize = 2;

		} else {

			componentSize = 4;

		}

		const byteLength = getPaddedBufferSize( count * attribute.itemSize * componentSize );
		const dataView = new DataView( new ArrayBuffer( byteLength ) );
		let offset = 0;

		for ( let i = start; i < start + count; i ++ ) {

			for ( let a = 0; a < attribute.itemSize; a ++ ) {

				let value;

				if ( attribute.itemSize > 4 ) {

					 // no support for interleaved data for itemSize > 4

					value = attribute.array[ i * attribute.itemSize + a ];

				} else {

					if ( a === 0 ) value = attribute.getX( i );
					else if ( a === 1 ) value = attribute.getY( i );
					else if ( a === 2 ) value = attribute.getZ( i );
					else if ( a === 3 ) value = attribute.getW( i );

				}

				if ( componentType === WEBGL_CONSTANTS.FLOAT ) {

					dataView.setFloat32( offset, value, true );

				} else if ( componentType === WEBGL_CONSTANTS.UNSIGNED_INT ) {

					dataView.setUint32( offset, value, true );

				} else if ( componentType === WEBGL_CONSTANTS.UNSIGNED_SHORT ) {

					dataView.setUint16( offset, value, true );

				} else if ( componentType === WEBGL_CONSTANTS.UNSIGNED_BYTE ) {

					dataView.setUint8( offset, value );

				}

				offset += componentSize;

			}

		}

		const bufferViewDef = {

			buffer: this.processBuffer( dataView.buffer ),
			byteOffset: this.byteOffset,
			byteLength: byteLength

		};

		if ( target !== undefined ) bufferViewDef.target = target;

		if ( target === WEBGL_CONSTANTS.ARRAY_BUFFER ) {

			// Only define byteStride for vertex attributes.
			bufferViewDef.byteStride = attribute.itemSize * componentSize;

		}

		this.byteOffset += byteLength;

		json.bufferViews.push( bufferViewDef );

		// @TODO Merge bufferViews where possible.
		const output = {

			id: json.bufferViews.length - 1,
			byteLength: 0

		};

		return output;

	}

	/**
	 * Process and generate a BufferView from an image Blob.
	 * @param {Blob} blob
	 * @return {Promise<Integer>}
	 */
	processBufferViewImage( blob ) {

		const writer = this;
		const json = writer.json;

		if ( ! json.bufferViews ) json.bufferViews = [];

		return new Promise( function ( resolve ) {

			const reader = new window.FileReader();
			reader.readAsArrayBuffer( blob );
			reader.onloadend = function () {

				const buffer = getPaddedArrayBuffer( reader.result );

				const bufferViewDef = {
					buffer: writer.processBuffer( buffer ),
					byteOffset: writer.byteOffset,
					byteLength: buffer.byteLength
				};

				writer.byteOffset += buffer.byteLength;
				resolve( json.bufferViews.push( bufferViewDef ) - 1 );

			};

		} );

	}

	/**
	 * Process attribute to generate an accessor
	 * @param  {BufferAttribute} attribute Attribute to process
	 * @param  {THREE.BufferGeometry} geometry (Optional) Geometry used for truncated draw range
	 * @param  {Integer} start (Optional)
	 * @param  {Integer} count (Optional)
	 * @return {Integer|null} Index of the processed accessor on the "accessors" array
	 */
	processAccessor( attribute, geometry, start, count ) {

		const options = this.options;
		const json = this.json;

		const types = {

			1: 'SCALAR',
			2: 'VEC2',
			3: 'VEC3',
			4: 'VEC4',
			16: 'MAT4'

		};

		let componentType;

		// Detect the component type of the attribute array (float, uint or ushort)
		if ( attribute.array.constructor === Float32Array ) {

			componentType = WEBGL_CONSTANTS.FLOAT;

		} else if ( attribute.array.constructor === Uint32Array ) {

			componentType = WEBGL_CONSTANTS.UNSIGNED_INT;

		} else if ( attribute.array.constructor === Uint16Array ) {

			componentType = WEBGL_CONSTANTS.UNSIGNED_SHORT;

		} else if ( attribute.array.constructor === Uint8Array ) {

			componentType = WEBGL_CONSTANTS.UNSIGNED_BYTE;

		} else {

			throw new Error( 'THREE.GLTFExporter: Unsupported bufferAttribute component type.' );

		}

		if ( start === undefined ) start = 0;
		if ( count === undefined ) count = attribute.count;

		// @TODO Indexed buffer geometry with drawRange not supported yet
		if ( options.truncateDrawRange && geometry !== undefined && geometry.index === null ) {

			const end = start + count;
			const end2 = geometry.drawRange.count === Infinity
				? attribute.count
				: geometry.drawRange.start + geometry.drawRange.count;

			start = Math.max( start, geometry.drawRange.start );
			count = Math.min( end, end2 ) - start;

			if ( count < 0 ) count = 0;

		}

		// Skip creating an accessor if the attribute doesn't have data to export
		if ( count === 0 ) return null;

		const minMax = getMinMax( attribute, start, count );
		let bufferViewTarget;

		// If geometry isn't provided, don't infer the target usage of the bufferView. For
		// animation samplers, target must not be set.
		if ( geometry !== undefined ) {

			bufferViewTarget = attribute === geometry.index ? WEBGL_CONSTANTS.ELEMENT_ARRAY_BUFFER : WEBGL_CONSTANTS.ARRAY_BUFFER;

		}

		const bufferView = this.processBufferView( attribute, componentType, start, count, bufferViewTarget );

		const accessorDef = {

			bufferView: bufferView.id,
			byteOffset: bufferView.byteOffset,
			componentType: componentType,
			count: count,
			max: minMax.max,
			min: minMax.min,
			type: types[ attribute.itemSize ]

		};

		if ( attribute.normalized === true ) accessorDef.normalized = true;
		if ( ! json.accessors ) json.accessors = [];

		return json.accessors.push( accessorDef ) - 1;

	}

	/**
	 * Process image
	 * @param  {Image} image to process
	 * @param  {Integer} format of the image (e.g. RGBFormat, RGBAFormat etc)
	 * @param  {Boolean} flipY before writing out the image
	 * @return {Integer}     Index of the processed texture in the "images" array
	 */
	processImage( image, format, flipY ) {

		const writer = this;
		const cache = writer.cache;
		const json = writer.json;
		const options = writer.options;
		const pending = writer.pending;

		if ( ! cache.images.has( image ) ) cache.images.set( image, {} );

		const cachedImages = cache.images.get( image );
		const mimeType = format === THREE.RGBAFormat ? 'image/png' : 'image/jpeg';
		const key = mimeType + ':flipY/' + flipY.toString();

		if ( cachedImages[ key ] !== undefined ) return cachedImages[ key ];

		if ( ! json.images ) json.images = [];

		const imageDef = { mimeType: mimeType };

		if ( options.embedImages ) {

			const canvas = cachedCanvas = cachedCanvas || document.createElement( 'canvas' );

			canvas.width = Math.min( image.width, options.maxTextureSize );
			canvas.height = Math.min( image.height, options.maxTextureSize );

			const ctx = canvas.getContext( '2d' );

			if ( flipY === true ) {

				ctx.translate( 0, canvas.height );
				ctx.scale( 1, - 1 );

			}

			if ( ( typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement ) ||
				( typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement ) ||
				( typeof OffscreenCanvas !== 'undefined' && image instanceof OffscreenCanvas ) ||
				( typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap ) ) {

				ctx.drawImage( image, 0, 0, canvas.width, canvas.height );

			} else {

				if ( format !== THREE.RGBAFormat && format !== THREE.RGBFormat ) {

					console.error( 'GLTFExporter: Only RGB and RGBA formats are supported.' );

				}

				if ( image.width > options.maxTextureSize || image.height > options.maxTextureSize ) {

					console.warn( 'GLTFExporter: Image size is bigger than maxTextureSize', image );

				}

				const data = new Uint8ClampedArray( image.height * image.width * 4 );

				if ( format === THREE.RGBAFormat ) {

					for ( let i = 0; i < data.length; i += 4 ) {

						data[ i + 0 ] = image.data[ i + 0 ];
						data[ i + 1 ] = image.data[ i + 1 ];
						data[ i + 2 ] = image.data[ i + 2 ];
						data[ i + 3 ] = image.data[ i + 3 ];

					}

				} else {

					for ( let i = 0, j = 0; i < data.length; i += 4, j += 3 ) {

						data[ i + 0 ] = image.data[ j + 0 ];
						data[ i + 1 ] = image.data[ j + 1 ];
						data[ i + 2 ] = image.data[ j + 2 ];
						data[ i + 3 ] = 255;

					}

				}

				ctx.putImageData( new ImageData( data, image.width, image.height ), 0, 0 );

			}

			if ( options.binary === true ) {

				pending.push( new Promise( function ( resolve ) {

					canvas.toBlob( function ( blob ) {

						writer.processBufferViewImage( blob ).then( function ( bufferViewIndex ) {

							imageDef.bufferView = bufferViewIndex;
							resolve();

						} );

					}, mimeType );

				} ) );

			} else {

				imageDef.uri = canvas.toDataURL( mimeType );

			}

		} else {

			imageDef.uri = image.src;

		}

		const index = json.images.push( imageDef ) - 1;
		cachedImages[ key ] = index;
		return index;

	}

	/**
	 * Process sampler
	 * @param  {Texture} map Texture to process
	 * @return {Integer}     Index of the processed texture in the "samplers" array
	 */
	processSampler( map ) {

		const json = this.json;

		if ( ! json.samplers ) json.samplers = [];

		const samplerDef = {
			magFilter: THREE_TO_WEBGL[ map.magFilter ],
			minFilter: THREE_TO_WEBGL[ map.minFilter ],
			wrapS: THREE_TO_WEBGL[ map.wrapS ],
			wrapT: THREE_TO_WEBGL[ map.wrapT ]
		};

		return json.samplers.push( samplerDef ) - 1;

	}

	/**
	 * Process texture
	 * @param  {Texture} map Map to process
	 * @return {Integer} Index of the processed texture in the "textures" array
	 */
	processTexture( map ) {

		const cache = this.cache;
		const json = this.json;

		if ( cache.textures.has( map ) ) return cache.textures.get( map );

		if ( ! json.textures ) json.textures = [];

		const textureDef = {
			sampler: this.processSampler( map ),
			source: this.processImage( map.image, map.format, map.flipY )
		};

		if ( map.name ) textureDef.name = map.name;

		this._invokeAll( function ( ext ) {

			ext.writeTexture && ext.writeTexture( map, textureDef );

		} );

		const index = json.textures.push( textureDef ) - 1;
		cache.textures.set( map, index );
		return index;

	}

	/**
	 * Process material
	 * @param  {THREE.Material} material Material to process
	 * @return {Integer|null} Index of the processed material in the "materials" array
	 */
	processMaterial( material ) {

		const cache = this.cache;
		const json = this.json;

		if ( cache.materials.has( material ) ) return cache.materials.get( material );

		if ( material.isShaderMaterial ) {

			console.warn( 'GLTFExporter: THREE.ShaderMaterial not supported.' );
			return null;

		}

		if ( ! json.materials ) json.materials = [];

		// @QUESTION Should we avoid including any attribute that has the default value?
		const materialDef = {	pbrMetallicRoughness: {} };

		if ( material.isMeshStandardMaterial !== true && material.isMeshBasicMaterial !== true ) {

			console.warn( 'GLTFExporter: Use MeshStandardMaterial or MeshBasicMaterial for best results.' );

		}

		// pbrMetallicRoughness.baseColorFactor
		const color = material.color.toArray().concat( [ material.opacity ] );

		if ( ! equalArray( color, [ 1, 1, 1, 1 ] ) ) {

			materialDef.pbrMetallicRoughness.baseColorFactor = color;

		}

		if ( material.isMeshStandardMaterial ) {

			materialDef.pbrMetallicRoughness.metallicFactor = material.metalness;
			materialDef.pbrMetallicRoughness.roughnessFactor = material.roughness;

		} else {

			materialDef.pbrMetallicRoughness.metallicFactor = 0.5;
			materialDef.pbrMetallicRoughness.roughnessFactor = 0.5;

		}

		// pbrMetallicRoughness.metallicRoughnessTexture
		if ( material.metalnessMap || material.roughnessMap ) {

			if ( material.metalnessMap === material.roughnessMap ) {

				const metalRoughMapDef = { index: this.processTexture( material.metalnessMap ) };
				this.applyTextureTransform( metalRoughMapDef, material.metalnessMap );
				materialDef.pbrMetallicRoughness.metallicRoughnessTexture = metalRoughMapDef;

			} else {

				console.warn( 'THREE.GLTFExporter: Ignoring metalnessMap and roughnessMap because they are not the same Texture.' );

			}

		}

		// pbrMetallicRoughness.baseColorTexture or pbrSpecularGlossiness diffuseTexture
		if ( material.map ) {

			const baseColorMapDef = { index: this.processTexture( material.map ) };
			this.applyTextureTransform( baseColorMapDef, material.map );
			materialDef.pbrMetallicRoughness.baseColorTexture = baseColorMapDef;

		}

		if ( material.emissive ) {

			// note: emissive components are limited to stay within the 0 - 1 range to accommodate glTF spec. see #21849 and #22000.
			const emissive = material.emissive.clone().multiplyScalar( material.emissiveIntensity );
			const maxEmissiveComponent = Math.max( emissive.r, emissive.g, emissive.b );

			if ( maxEmissiveComponent > 1 ) {

				emissive.multiplyScalar( 1 / maxEmissiveComponent );

				console.warn( 'THREE.GLTFExporter: Some emissive components exceed 1; emissive has been limited' );

			}

			if ( maxEmissiveComponent > 0 ) {

				materialDef.emissiveFactor = emissive.toArray();

			}

			// emissiveTexture
			if ( material.emissiveMap ) {

				const emissiveMapDef = { index: this.processTexture( material.emissiveMap ) };
				this.applyTextureTransform( emissiveMapDef, material.emissiveMap );
				materialDef.emissiveTexture = emissiveMapDef;

			}

		}

		// normalTexture
		if ( material.normalMap ) {

			const normalMapDef = { index: this.processTexture( material.normalMap ) };

			if ( material.normalScale && material.normalScale.x !== 1 ) {

				// glTF normal scale is univariate. Ignore `y`, which may be flipped.
				// Context: https://github.com/mrdoob/three.js/issues/11438#issuecomment-507003995
				normalMapDef.scale = material.normalScale.x;

			}

			this.applyTextureTransform( normalMapDef, material.normalMap );
			materialDef.normalTexture = normalMapDef;

		}

		// occlusionTexture
		if ( material.aoMap ) {

			const occlusionMapDef = {
				index: this.processTexture( material.aoMap ),
				texCoord: 1
			};

			if ( material.aoMapIntensity !== 1.0 ) {

				occlusionMapDef.strength = material.aoMapIntensity;

			}

			this.applyTextureTransform( occlusionMapDef, material.aoMap );
			materialDef.occlusionTexture = occlusionMapDef;

		}

		// alphaMode
		if ( material.transparent ) {

			materialDef.alphaMode = 'BLEND';

		} else {

			if ( material.alphaTest > 0.0 ) {

				materialDef.alphaMode = 'MASK';
				materialDef.alphaCutoff = material.alphaTest;

			}

		}

		// doubleSided
		if ( material.side === THREE.DoubleSide ) materialDef.doubleSided = true;
		if ( material.name !== '' ) materialDef.name = material.name;

		this.serializeUserData( material, materialDef );

		this._invokeAll( function ( ext ) {

			ext.writeMaterial && ext.writeMaterial( material, materialDef );

		} );

		const index = json.materials.push( materialDef ) - 1;
		cache.materials.set( material, index );
		return index;

	}

	/**
	 * Process mesh
	 * @param  {THREE.Mesh} mesh Mesh to process
	 * @return {Integer|null} Index of the processed mesh in the "meshes" array
	 */
	processMesh( mesh ) {

		const cache = this.cache;
		const json = this.json;

		const meshCacheKeyParts = [ mesh.geometry.uuid ];

		if ( Array.isArray( mesh.material ) ) {

			for ( let i = 0, l = mesh.material.length; i < l; i ++ ) {

				meshCacheKeyParts.push( mesh.material[ i ].uuid	);

			}

		} else {

			meshCacheKeyParts.push( mesh.material.uuid );

		}

		const meshCacheKey = meshCacheKeyParts.join( ':' );

		if ( cache.meshes.has( meshCacheKey ) ) return cache.meshes.get( meshCacheKey );

		const geometry = mesh.geometry;
		let mode;

		// Use the correct mode
		if ( mesh.isLineSegments ) {

			mode = WEBGL_CONSTANTS.LINES;

		} else if ( mesh.isLineLoop ) {

			mode = WEBGL_CONSTANTS.LINE_LOOP;

		} else if ( mesh.isLine ) {

			mode = WEBGL_CONSTANTS.LINE_STRIP;

		} else if ( mesh.isPoints ) {

			mode = WEBGL_CONSTANTS.POINTS;

		} else {

			mode = mesh.material.wireframe ? WEBGL_CONSTANTS.LINES : WEBGL_CONSTANTS.TRIANGLES;

		}

		if ( geometry.isBufferGeometry !== true ) {

			throw new Error( 'THREE.GLTFExporter: Geometry is not of type THREE.BufferGeometry.' );

		}

		const meshDef = {};
		const attributes = {};
		const primitives = [];
		const targets = [];

		// Conversion between attributes names in threejs and gltf spec
		const nameConversion = {
			uv: 'TEXCOORD_0',
			uv2: 'TEXCOORD_1',
			color: 'COLOR_0',
			skinWeight: 'WEIGHTS_0',
			skinIndex: 'JOINTS_0'
		};

		const originalNormal = geometry.getAttribute( 'normal' );

		if ( originalNormal !== undefined && ! this.isNormalizedNormalAttribute( originalNormal ) ) {

			console.warn( 'THREE.GLTFExporter: Creating normalized normal attribute from the non-normalized one.' );

			geometry.setAttribute( 'normal', this.createNormalizedNormalAttribute( originalNormal ) );

		}

		// @QUESTION Detect if .vertexColors = true?
		// For every attribute create an accessor
		let modifiedAttribute = null;

		for ( let attributeName in geometry.attributes ) {

			// Ignore morph target attributes, which are exported later.
			if ( attributeName.substr( 0, 5 ) === 'morph' ) continue;

			const attribute = geometry.attributes[ attributeName ];
			attributeName = nameConversion[ attributeName ] || attributeName.toUpperCase();

			// Prefix all geometry attributes except the ones specifically
			// listed in the spec; non-spec attributes are considered custom.
			const validVertexAttributes =
					/^(POSITION|NORMAL|TANGENT|TEXCOORD_\d+|COLOR_\d+|JOINTS_\d+|WEIGHTS_\d+)$/;

			if ( ! validVertexAttributes.test( attributeName ) ) attributeName = '_' + attributeName;

			if ( cache.attributes.has( this.getUID( attribute ) ) ) {

				attributes[ attributeName ] = cache.attributes.get( this.getUID( attribute ) );
				continue;

			}

			// JOINTS_0 must be UNSIGNED_BYTE or UNSIGNED_SHORT.
			modifiedAttribute = null;
			const array = attribute.array;

			if ( attributeName === 'JOINTS_0' &&
				! ( array instanceof Uint16Array ) &&
				! ( array instanceof Uint8Array ) ) {

				console.warn( 'GLTFExporter: Attribute "skinIndex" converted to type UNSIGNED_SHORT.' );
				modifiedAttribute = new THREE.BufferAttribute( new Uint16Array( array ), attribute.itemSize, attribute.normalized );

			}

			const accessor = this.processAccessor( modifiedAttribute || attribute, geometry );

			if ( accessor !== null ) {

				attributes[ attributeName ] = accessor;
				cache.attributes.set( this.getUID( attribute ), accessor );

			}

		}

		if ( originalNormal !== undefined ) geometry.setAttribute( 'normal', originalNormal );

		// Skip if no exportable attributes found
		if ( Object.keys( attributes ).length === 0 ) return null;

		// Morph targets
		if ( mesh.morphTargetInfluences !== undefined && mesh.morphTargetInfluences.length > 0 ) {

			const weights = [];
			const targetNames = [];
			const reverseDictionary = {};

			if ( mesh.morphTargetDictionary !== undefined ) {

				for ( const key in mesh.morphTargetDictionary ) {

					reverseDictionary[ mesh.morphTargetDictionary[ key ] ] = key;

				}

			}

			for ( let i = 0; i < mesh.morphTargetInfluences.length; ++ i ) {

				const target = {};
				let warned = false;

				for ( const attributeName in geometry.morphAttributes ) {

					// glTF 2.0 morph supports only POSITION/NORMAL/TANGENT.
					// Three.js doesn't support TANGENT yet.

					if ( attributeName !== 'position' && attributeName !== 'normal' ) {

						if ( ! warned ) {

							console.warn( 'GLTFExporter: Only POSITION and NORMAL morph are supported.' );
							warned = true;

						}

						continue;

					}

					const attribute = geometry.morphAttributes[ attributeName ][ i ];
					const gltfAttributeName = attributeName.toUpperCase();

					// Three.js morph attribute has absolute values while the one of glTF has relative values.
					//
					// glTF 2.0 Specification:
					// https://github.com/KhronosGroup/glTF/tree/master/specification/2.0#morph-targets

					const baseAttribute = geometry.attributes[ attributeName ];

					if ( cache.attributes.has( this.getUID( attribute ) ) ) {

						target[ gltfAttributeName ] = cache.attributes.get( this.getUID( attribute ) );
						continue;

					}

					// Clones attribute not to override
					const relativeAttribute = attribute.clone();

					if ( ! geometry.morphTargetsRelative ) {

						for ( let j = 0, jl = attribute.count; j < jl; j ++ ) {

							relativeAttribute.setXYZ(
								j,
								attribute.getX( j ) - baseAttribute.getX( j ),
								attribute.getY( j ) - baseAttribute.getY( j ),
								attribute.getZ( j ) - baseAttribute.getZ( j )
							);

						}

					}

					target[ gltfAttributeName ] = this.processAccessor( relativeAttribute, geometry );
					cache.attributes.set( this.getUID( baseAttribute ), target[ gltfAttributeName ] );

				}

				targets.push( target );

				weights.push( mesh.morphTargetInfluences[ i ] );

				if ( mesh.morphTargetDictionary !== undefined ) targetNames.push( reverseDictionary[ i ] );

			}

			meshDef.weights = weights;

			if ( targetNames.length > 0 ) {

				meshDef.extras = {};
				meshDef.extras.targetNames = targetNames;

			}

		}

		const isMultiMaterial = Array.isArray( mesh.material );

		if ( isMultiMaterial && geometry.groups.length === 0 ) return null;

		const materials = isMultiMaterial ? mesh.material : [ mesh.material ];
		const groups = isMultiMaterial ? geometry.groups : [ { materialIndex: 0, start: undefined, count: undefined } ];

		for ( let i = 0, il = groups.length; i < il; i ++ ) {

			const primitive = {
				mode: mode,
				attributes: attributes,
			};

			this.serializeUserData( geometry, primitive );

			if ( targets.length > 0 ) primitive.targets = targets;

			if ( geometry.index !== null ) {

				let cacheKey = this.getUID( geometry.index );

				if ( groups[ i ].start !== undefined || groups[ i ].count !== undefined ) {

					cacheKey += ':' + groups[ i ].start + ':' + groups[ i ].count;

				}

				if ( cache.attributes.has( cacheKey ) ) {

					primitive.indices = cache.attributes.get( cacheKey );

				} else {

					primitive.indices = this.processAccessor( geometry.index, geometry, groups[ i ].start, groups[ i ].count );
					cache.attributes.set( cacheKey, primitive.indices );

				}

				if ( primitive.indices === null ) delete primitive.indices;

			}

			const material = this.processMaterial( materials[ groups[ i ].materialIndex ] );

			if ( material !== null ) primitive.material = material;

			primitives.push( primitive );

		}

		meshDef.primitives = primitives;

		if ( ! json.meshes ) json.meshes = [];

		this._invokeAll( function ( ext ) {

			ext.writeMesh && ext.writeMesh( mesh, meshDef );

		} );

		const index = json.meshes.push( meshDef ) - 1;
		cache.meshes.set( meshCacheKey, index );
		return index;

	}

	/**
	 * Process camera
	 * @param  {THREE.Camera} camera Camera to process
	 * @return {Integer}      Index of the processed mesh in the "camera" array
	 */
	processCamera( camera ) {

		const json = this.json;

		if ( ! json.cameras ) json.cameras = [];

		const isOrtho = camera.isOrthographicCamera;

		const cameraDef = {
			type: isOrtho ? 'orthographic' : 'perspective'
		};

		if ( isOrtho ) {

			cameraDef.orthographic = {
				xmag: camera.right * 2,
				ymag: camera.top * 2,
				zfar: camera.far <= 0 ? 0.001 : camera.far,
				znear: camera.near < 0 ? 0 : camera.near
			};

		} else {

			cameraDef.perspective = {
				aspectRatio: camera.aspect,
				yfov: THREE.MathUtils.degToRad( camera.fov ),
				zfar: camera.far <= 0 ? 0.001 : THREE.camera.far,
				znear: camera.near < 0 ? 0 : camera.near
			};

		}

		// Question: Is saving "type" as name intentional?
		if ( camera.name !== '' ) cameraDef.name = camera.type;

		return json.cameras.push( cameraDef ) - 1;

	}

	/**
	 * Creates glTF animation entry from AnimationClip object.
	 *
	 * Status:
	 * - Only properties listed in PATH_PROPERTIES may be animated.
	 *
	 * @param {THREE.AnimationClip} clip
	 * @param {THREE.Object3D} root
	 * @return {number|null}
	 */
	processAnimation( clip, root ) {

		const json = this.json;
		const nodeMap = this.nodeMap;

		if ( ! json.animations ) json.animations = [];

		clip = GLTFExporter.Utils.mergeMorphTargetTracks( clip.clone(), root );

		const tracks = clip.tracks;
		const channels = [];
		const samplers = [];

		for ( let i = 0; i < tracks.length; ++ i ) {

			const track = tracks[ i ];
			const trackBinding = THREE.PropertyBinding.parseTrackName( track.name );
			let trackNode = THREE.PropertyBinding.findNode( root, trackBinding.nodeName );
			const trackProperty = PATH_PROPERTIES[ trackBinding.propertyName ];

			if ( trackBinding.objectName === 'bones' ) {

				if ( trackNode.isSkinnedMesh === true ) {

					trackNode = trackNode.skeleton.getBoneByName( trackBinding.objectIndex );

				} else {

					trackNode = undefined;

				}

			}

			if ( ! trackNode || ! trackProperty ) {

				console.warn( 'THREE.GLTFExporter: Could not export animation track "%s".', track.name );
				return null;

			}

			const inputItemSize = 1;
			let outputItemSize = track.values.length / track.times.length;

			if ( trackProperty === PATH_PROPERTIES.morphTargetInfluences ) {

				outputItemSize /= trackNode.morphTargetInfluences.length;

			}

			let interpolation;

			// @TODO export CubicInterpolant(InterpolateSmooth) as CUBICSPLINE

			// Detecting glTF cubic spline interpolant by checking factory method's special property
			// GLTFCubicSplineInterpolant is a custom interpolant and track doesn't return
			// valid value from .getInterpolation().
			if ( track.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline === true ) {

				interpolation = 'CUBICSPLINE';

				// itemSize of CUBICSPLINE keyframe is 9
				// (VEC3 * 3: inTangent, splineVertex, and outTangent)
				// but needs to be stored as VEC3 so dividing by 3 here.
				outputItemSize /= 3;

			} else if ( track.getInterpolation() === THREE.InterpolateDiscrete ) {

				interpolation = 'STEP';

			} else {

				interpolation = 'LINEAR';

			}

			samplers.push( {
				input: this.processAccessor( new THREE.BufferAttribute( track.times, inputItemSize ) ),
				output: this.processAccessor( new THREE.BufferAttribute( track.values, outputItemSize ) ),
				interpolation: interpolation
			} );

			channels.push( {
				sampler: samplers.length - 1,
				target: {
					node: nodeMap.get( trackNode ),
					path: trackProperty
				}
			} );

		}

		json.animations.push( {
			name: clip.name || 'clip_' + json.animations.length,
			samplers: samplers,
			channels: channels
		} );

		return json.animations.length - 1;

	}

	/**
	 * @param {THREE.Object3D} object
	 * @return {number|null}
	 */
	 processSkin( object ) {

		const json = this.json;
		const nodeMap = this.nodeMap;

		const node = json.nodes[ nodeMap.get( object ) ];

		const skeleton = object.skeleton;

		if ( skeleton === undefined ) return null;

		const rootJoint = object.skeleton.bones[ 0 ];

		if ( rootJoint === undefined ) return null;

		const joints = [];
		const inverseBindMatrices = new Float32Array( skeleton.bones.length * 16 );
		const temporaryBoneInverse = new THREE.Matrix4();

		for ( let i = 0; i < skeleton.bones.length; ++ i ) {

			joints.push( nodeMap.get( skeleton.bones[ i ] ) );
			temporaryBoneInverse.copy( skeleton.boneInverses[ i ] );
			temporaryBoneInverse.multiply( object.bindMatrix ).toArray( inverseBindMatrices, i * 16 );

		}

		if ( json.skins === undefined ) json.skins = [];

		json.skins.push( {
			inverseBindMatrices: this.processAccessor( new THREE.BufferAttribute( inverseBindMatrices, 16 ) ),
			joints: joints,
			skeleton: nodeMap.get( rootJoint )
		} );

		const skinIndex = node.skin = json.skins.length - 1;

		return skinIndex;

	}

	/**
	 * Process Object3D node
	 * @param  {THREE.Object3D} node Object3D to processNode
	 * @return {Integer} Index of the node in the nodes list
	 */
	processNode( object ) {

		const json = this.json;
		const options = this.options;
		const nodeMap = this.nodeMap;

		if ( ! json.nodes ) json.nodes = [];

		const nodeDef = {};

		if ( options.trs ) {

			const rotation = object.quaternion.toArray();
			const position = object.position.toArray();
			const scale = object.scale.toArray();

			if ( ! equalArray( rotation, [ 0, 0, 0, 1 ] ) ) {

				nodeDef.rotation = rotation;

			}

			if ( ! equalArray( position, [ 0, 0, 0 ] ) ) {

				nodeDef.translation = position;

			}

			if ( ! equalArray( scale, [ 1, 1, 1 ] ) ) {

				nodeDef.scale = scale;

			}

		} else {

			if ( object.matrixAutoUpdate ) {

				object.updateMatrix();

			}

			if ( isIdentityMatrix( object.matrix ) === false ) {

				nodeDef.matrix = object.matrix.elements;

			}

		}

		// We don't export empty strings name because it represents no-name in Three.js.
		if ( object.name !== '' ) nodeDef.name = String( object.name );

		this.serializeUserData( object, nodeDef );

		if ( object.isMesh || object.isLine || object.isPoints ) {

			const meshIndex = this.processMesh( object );

			if ( meshIndex !== null ) nodeDef.mesh = meshIndex;

		} else if ( object.isCamera ) {

			nodeDef.camera = this.processCamera( object );

		}

		if ( object.isSkinnedMesh ) this.skins.push( object );

		if ( object.children.length > 0 ) {

			const children = [];

			for ( let i = 0, l = object.children.length; i < l; i ++ ) {

				const child = object.children[ i ];

				if ( child.visible || options.onlyVisible === false ) {

					const nodeIndex = this.processNode( child );

					if ( nodeIndex !== null ) children.push( nodeIndex );

				}

			}

			if ( children.length > 0 ) nodeDef.children = children;

		}

		this._invokeAll( function ( ext ) {

			ext.writeNode && ext.writeNode( object, nodeDef );

		} );

		const nodeIndex = json.nodes.push( nodeDef ) - 1;
		nodeMap.set( object, nodeIndex );
		return nodeIndex;

	}

	/**
	 * Process Scene
	 * @param  {Scene} node Scene to process
	 */
	processScene( scene ) {

		const json = this.json;
		const options = this.options;

		if ( ! json.scenes ) {

			json.scenes = [];
			json.scene = 0;

		}

		const sceneDef = {};

		if ( scene.name !== '' ) sceneDef.name = scene.name;

		json.scenes.push( sceneDef );

		const nodes = [];

		for ( let i = 0, l = scene.children.length; i < l; i ++ ) {

			const child = scene.children[ i ];

			if ( child.visible || options.onlyVisible === false ) {

				const nodeIndex = this.processNode( child );

				if ( nodeIndex !== null ) nodes.push( nodeIndex );

			}

		}

		if ( nodes.length > 0 ) sceneDef.nodes = nodes;

		this.serializeUserData( scene, sceneDef );

	}

	/**
	 * Creates a Scene to hold a list of objects and parse it
	 * @param  {Array} objects List of objects to process
	 */
	processObjects( objects ) {

		const scene = new THREE.Scene();
		scene.name = 'AuxScene';

		for ( let i = 0; i < objects.length; i ++ ) {

			// We push directly to children instead of calling `add` to prevent
			// modify the .parent and break its original scene and hierarchy
			scene.children.push( objects[ i ] );

		}

		this.processScene( scene );

	}

	/**
	 * @param {THREE.Object3D|Array<THREE.Object3D>} input
	 */
	processInput( input ) {

		const options = this.options;

		input = input instanceof Array ? input : [ input ];

		this._invokeAll( function ( ext ) {

			ext.beforeParse && ext.beforeParse( input );

		} );

		const objectsWithoutScene = [];

		for ( let i = 0; i < input.length; i ++ ) {

			if ( input[ i ] instanceof THREE.Scene ) {THREE.

				this.processScene( input[ i ] );

			} else {

				objectsWithoutScene.push( input[ i ] );

			}

		}

		if ( objectsWithoutScene.length > 0 ) this.processObjects( objectsWithoutScene );

		for ( let i = 0; i < this.skins.length; ++ i ) {

			this.processSkin( this.skins[ i ] );

		}

		for ( let i = 0; i < options.animations.length; ++ i ) {

			this.processAnimation( options.animations[ i ], input[ 0 ] );

		}

		this._invokeAll( function ( ext ) {

			ext.afterParse && ext.afterParse( input );

		} );

	}

	_invokeAll( func ) {

		for ( let i = 0, il = this.plugins.length; i < il; i ++ ) {

			func( this.plugins[ i ] );

		}

	}

}

/**
 * Punctual Lights Extension
 *
 * Specification: https://github.com/KhronosGroup/glTF/tree/master/extensions/2.0/Khronos/KHR_lights_punctual
 */
class GLTFLightExtension {

	constructor( writer ) {

		this.writer = writer;
		this.name = 'KHR_lights_punctual';

	}

	writeNode( light, nodeDef ) {

		if ( ! light.isLight ) return;

		if ( ! light.isDirectionalLight && ! light.isPointLight && ! light.isSpotLight ) {

			console.warn( 'THREE.GLTFExporter: Only directional, point, and spot lights are supported.', light );
			return;

		}

		const writer = this.writer;
		const json = writer.json;
		const extensionsUsed = writer.extensionsUsed;

		const lightDef = {};

		if ( light.name ) lightDef.name = light.name;

		lightDef.color = light.color.toArray();

		lightDef.intensity = light.intensity;

		if ( light.isDirectionalLight ) {

			lightDef.type = 'directional';

		} else if ( light.isPointLight ) {

			lightDef.type = 'point';

			if ( light.distance > 0 ) lightDef.range = light.distance;

		} else if ( light.isSpotLight ) {

			lightDef.type = 'spot';

			if ( light.distance > 0 ) lightDef.range = light.distance;

			lightDef.spot = {};
			lightDef.spot.innerConeAngle = ( light.penumbra - 1.0 ) * light.angle * - 1.0;
			lightDef.spot.outerConeAngle = light.angle;

		}

		if ( light.decay !== undefined && light.decay !== 2 ) {

			console.warn( 'THREE.GLTFExporter: Light decay may be lost. glTF is physically-based, '
				+ 'and expects light.decay=2.' );

		}

		if ( light.target
				&& ( light.target.parent !== light
				|| light.target.position.x !== 0
				|| light.target.position.y !== 0
				|| light.target.position.z !== - 1 ) ) {

			console.warn( 'THREE.GLTFExporter: Light direction may be lost. For best results, '
				+ 'make light.target a child of the light with position 0,0,-1.' );

		}

		if ( ! extensionsUsed[ this.name ] ) {

			json.extensions = json.extensions || {};
			json.extensions[ this.name ] = { lights: [] };
			extensionsUsed[ this.name ] = true;

		}

		const lights = json.extensions[ this.name ].lights;
		lights.push( lightDef );

		nodeDef.extensions = nodeDef.extensions || {};
		nodeDef.extensions[ this.name ] = { light: lights.length - 1 };

	}

}

/**
 * Unlit Materials Extension
 *
 * Specification: https://github.com/KhronosGroup/glTF/tree/master/extensions/2.0/Khronos/KHR_materials_unlit
 */
class GLTFMaterialsUnlitExtension {

	constructor( writer ) {

		this.writer = writer;
		this.name = 'KHR_materials_unlit';

	}

	writeMaterial( material, materialDef ) {

		if ( ! material.isMeshBasicMaterial ) return;

		const writer = this.writer;
		const extensionsUsed = writer.extensionsUsed;

		materialDef.extensions = materialDef.extensions || {};
		materialDef.extensions[ this.name ] = {};

		extensionsUsed[ this.name ] = true;

		materialDef.pbrMetallicRoughness.metallicFactor = 0.0;
		materialDef.pbrMetallicRoughness.roughnessFactor = 0.9;

	}

}

/**
 * Specular-Glossiness Extension
 *
 * Specification: https://github.com/KhronosGroup/glTF/tree/master/extensions/2.0/Khronos/KHR_materials_pbrSpecularGlossiness
 */
class GLTFMaterialsPBRSpecularGlossiness {

	constructor( writer ) {

		this.writer = writer;
		this.name = 'KHR_materials_pbrSpecularGlossiness';

	}

	writeMaterial( material, materialDef ) {

		if ( ! material.isGLTFSpecularGlossinessMaterial ) return;

		const writer = this.writer;
		const extensionsUsed = writer.extensionsUsed;

		const extensionDef = {};

		if ( materialDef.pbrMetallicRoughness.baseColorFactor ) {

			extensionDef.diffuseFactor = materialDef.pbrMetallicRoughness.baseColorFactor;

		}

		const specularFactor = [ 1, 1, 1 ];
		material.specular.toArray( specularFactor, 0 );
		extensionDef.specularFactor = specularFactor;
		extensionDef.glossinessFactor = material.glossiness;

		if ( materialDef.pbrMetallicRoughness.baseColorTexture ) {

			extensionDef.diffuseTexture = materialDef.pbrMetallicRoughness.baseColorTexture;

		}

		if ( material.specularMap ) {

			const specularMapDef = { index: writer.processTexture( material.specularMap ) };
			writer.applyTextureTransform( specularMapDef, material.specularMap );
			extensionDef.specularGlossinessTexture = specularMapDef;

		}

		materialDef.extensions = materialDef.extensions || {};
		materialDef.extensions[ this.name ] = extensionDef;
		extensionsUsed[ this.name ] = true;

	}

}

/**
 * Clearcoat Materials Extension
 *
 * Specification: https://github.com/KhronosGroup/glTF/tree/master/extensions/2.0/Khronos/KHR_materials_clearcoat
 */
class GLTFMaterialsClearcoatExtension {

	constructor( writer ) {

		this.writer = writer;
		this.name = 'KHR_materials_clearcoat';

	}

	writeMaterial( material, materialDef ) {

		if ( ! material.isMeshPhysicalMaterial ) return;

		const writer = this.writer;
		const extensionsUsed = writer.extensionsUsed;

		const extensionDef = {};

		extensionDef.clearcoatFactor = material.clearcoat;

		if ( material.clearcoatMap ) {

			const clearcoatMapDef = { index: writer.processTexture( material.clearcoatMap ) };
			writer.applyTextureTransform( clearcoatMapDef, material.clearcoatMap );
			extensionDef.clearcoatTexture = clearcoatMapDef;

		}

		extensionDef.clearcoatRoughnessFactor = material.clearcoatRoughness;

		if ( material.clearcoatRoughnessMap ) {

			const clearcoatRoughnessMapDef = { index: writer.processTexture( material.clearcoatRoughnessMap ) };
			writer.applyTextureTransform( clearcoatRoughnessMapDef, material.clearcoatRoughnessMap );
			extensionDef.clearcoatRoughnessTexture = clearcoatRoughnessMapDef;

		}

		if ( material.clearcoatNormalMap ) {

			const clearcoatNormalMapDef = { index: writer.processTexture( material.clearcoatNormalMap ) };
			writer.applyTextureTransform( clearcoatNormalMapDef, material.clearcoatNormalMap );
			extensionDef.clearcoatNormalTexture = clearcoatNormalMapDef;

		}

		materialDef.extensions = materialDef.extensions || {};
		materialDef.extensions[ this.name ] = extensionDef;

		extensionsUsed[ this.name ] = true;


	}

}

/**
 * Transmission Materials Extension
 *
 * Specification: https://github.com/KhronosGroup/glTF/tree/master/extensions/2.0/Khronos/KHR_materials_transmission
 */
class GLTFMaterialsTransmissionExtension {

	constructor( writer ) {

		this.writer = writer;
		this.name = 'KHR_materials_transmission';

	}

	writeMaterial( material, materialDef ) {

		if ( ! material.isMeshPhysicalMaterial || material.transmission === 0 ) return;

		const writer = this.writer;
		const extensionsUsed = writer.extensionsUsed;

		const extensionDef = {};

		extensionDef.transmissionFactor = material.transmission;

		if ( material.transmissionMap ) {

			const transmissionMapDef = { index: writer.processTexture( material.transmissionMap ) };
			writer.applyTextureTransform( transmissionMapDef, material.transmissionMap );
			extensionDef.transmissionTexture = transmissionMapDef;

		}

		materialDef.extensions = materialDef.extensions || {};
		materialDef.extensions[ this.name ] = extensionDef;

		extensionsUsed[ this.name ] = true;

	}

}

/**
 * Materials Volume Extension
 *
 * Specification: https://github.com/KhronosGroup/glTF/tree/master/extensions/2.0/Khronos/KHR_materials_volume
 */
class GLTFMaterialsVolumeExtension {

	constructor( writer ) {

		this.writer = writer;
		this.name = 'KHR_materials_volume';

	}

	writeMaterial( material, materialDef ) {

		if ( ! material.isMeshPhysicalMaterial || material.transmission === 0 ) return;

		const writer = this.writer;
		const extensionsUsed = writer.extensionsUsed;

		const extensionDef = {};

		extensionDef.thicknessFactor = material.thickness;

		if ( material.thicknessMap ) {

			const thicknessMapDef = { index: writer.processTexture( material.thicknessMap ) };
			writer.applyTextureTransform( thicknessMapDef, material.thicknessMap );
			extensionDef.thicknessTexture = thicknessMapDef;

		}

		extensionDef.attenuationDistance = material.attenuationDistance;
		extensionDef.attenuationColor = material.attenuationColor.toArray();

		materialDef.extensions = materialDef.extensions || {};
		materialDef.extensions[ this.name ] = extensionDef;

		extensionsUsed[ this.name ] = true;

	}

}

/**
 * Static utility functions
 */
GLTFExporter.Utils = {

	insertKeyframe: function ( track, time ) {

		const tolerance = 0.001; // 1ms
		const valueSize = track.getValueSize();

		const times = new track.TimeBufferType( track.times.length + 1 );
		const values = new track.ValueBufferType( track.values.length + valueSize );
		const interpolant = track.createInterpolant( new track.ValueBufferType( valueSize ) );

		let index;

		if ( track.times.length === 0 ) {

			times[ 0 ] = time;

			for ( let i = 0; i < valueSize; i ++ ) {

				values[ i ] = 0;

			}

			index = 0;

		} else if ( time < track.times[ 0 ] ) {

			if ( Math.abs( track.times[ 0 ] - time ) < tolerance ) return 0;

			times[ 0 ] = time;
			times.set( track.times, 1 );

			values.set( interpolant.evaluate( time ), 0 );
			values.set( track.values, valueSize );

			index = 0;

		} else if ( time > track.times[ track.times.length - 1 ] ) {

			if ( Math.abs( track.times[ track.times.length - 1 ] - time ) < tolerance ) {

				return track.times.length - 1;

			}

			times[ times.length - 1 ] = time;
			times.set( track.times, 0 );

			values.set( track.values, 0 );
			values.set( interpolant.evaluate( time ), track.values.length );

			index = times.length - 1;

		} else {

			for ( let i = 0; i < track.times.length; i ++ ) {

				if ( Math.abs( track.times[ i ] - time ) < tolerance ) return i;

				if ( track.times[ i ] < time && track.times[ i + 1 ] > time ) {

					times.set( track.times.slice( 0, i + 1 ), 0 );
					times[ i + 1 ] = time;
					times.set( track.times.slice( i + 1 ), i + 2 );

					values.set( track.values.slice( 0, ( i + 1 ) * valueSize ), 0 );
					values.set( interpolant.evaluate( time ), ( i + 1 ) * valueSize );
					values.set( track.values.slice( ( i + 1 ) * valueSize ), ( i + 2 ) * valueSize );

					index = i + 1;

					break;

				}

			}

		}

		track.times = times;
		track.values = values;

		return index;

	},

	mergeMorphTargetTracks: function ( clip, root ) {

		const tracks = [];
		const mergedTracks = {};
		const sourceTracks = clip.tracks;

		for ( let i = 0; i < sourceTracks.length; ++ i ) {

			let sourceTrack = sourceTracks[ i ];
			const sourceTrackBinding = THREE.PropertyBinding.parseTrackName( sourceTrack.name );
			const sourceTrackNode = THREE.PropertyBinding.findNode( root, sourceTrackBinding.nodeName );

			if ( sourceTrackBinding.propertyName !== 'morphTargetInfluences' || sourceTrackBinding.propertyIndex === undefined ) {

				// Tracks that don't affect morph targets, or that affect all morph targets together, can be left as-is.
				tracks.push( sourceTrack );
				continue;

			}

			if ( sourceTrack.createInterpolant !== sourceTrack.InterpolantFactoryMethodDiscrete
				&& sourceTrack.createInterpolant !== sourceTrack.InterpolantFactoryMethodLinear ) {

				if ( sourceTrack.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline ) {

					// This should never happen, because glTF morph target animations
					// affect all targets already.
					throw new Error( 'THREE.GLTFExporter: Cannot merge tracks with glTF CUBICSPLINE interpolation.' );

				}

				console.warn( 'THREE.GLTFExporter: Morph target interpolation mode not yet supported. Using LINEAR instead.' );

				sourceTrack = sourceTrack.clone();
				sourceTrack.setInterpolation( THREE.InterpolateLinear );

			}

			const targetCount = sourceTrackNode.morphTargetInfluences.length;
			const targetIndex = sourceTrackNode.morphTargetDictionary[ sourceTrackBinding.propertyIndex ];

			if ( targetIndex === undefined ) {

				throw new Error( 'THREE.GLTFExporter: Morph target name not found: ' + sourceTrackBinding.propertyIndex );

			}

			let mergedTrack;

			// If this is the first time we've seen this object, create a new
			// track to store merged keyframe data for each morph target.
			if ( mergedTracks[ sourceTrackNode.uuid ] === undefined ) {

				mergedTrack = sourceTrack.clone();

				const values = new mergedTrack.ValueBufferType( targetCount * mergedTrack.times.length );

				for ( let j = 0; j < mergedTrack.times.length; j ++ ) {

					values[ j * targetCount + targetIndex ] = mergedTrack.values[ j ];

				}

				// We need to take into consideration the intended target node
				// of our original un-merged morphTarget animation.
				mergedTrack.name = ( sourceTrackBinding.nodeName || '' ) + '.morphTargetInfluences';
				mergedTrack.values = values;

				mergedTracks[ sourceTrackNode.uuid ] = mergedTrack;
				tracks.push( mergedTrack );

				continue;

			}

			const sourceInterpolant = sourceTrack.createInterpolant( new sourceTrack.ValueBufferType( 1 ) );

			mergedTrack = mergedTracks[ sourceTrackNode.uuid ];

			// For every existing keyframe of the merged track, write a (possibly
			// interpolated) value from the source track.
			for ( let j = 0; j < mergedTrack.times.length; j ++ ) {

				mergedTrack.values[ j * targetCount + targetIndex ] = sourceInterpolant.evaluate( mergedTrack.times[ j ] );

			}

			// For every existing keyframe of the source track, write a (possibly
			// new) keyframe to the merged track. Values from the previous loop may
			// be written again, but keyframes are de-duplicated.
			for ( let j = 0; j < sourceTrack.times.length; j ++ ) {

				const keyframeIndex = this.insertKeyframe( mergedTrack, sourceTrack.times[ j ] );
				mergedTrack.values[ keyframeIndex * targetCount + targetIndex ] = sourceTrack.values[ j ];

			}

		}

		clip.tracks = tracks;

		return clip;

	}

};

// =====================================================
// /playground/vertexnormalshelper.js
// =====================================================

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _normalMatrix = new THREE.Matrix3();

class VertexNormalsHelper extends THREE.LineSegments {

	constructor( object, size = 1, color = 0xff0000 ) {

		const geometry = new THREE.BufferGeometry();

		const nNormals = object.geometry.attributes.normal.count;
		const positions = new THREE.Float32BufferAttribute( nNormals * 2 * 3, 3 );

		geometry.setAttribute( 'position', positions );

		super( geometry, new THREE.LineBasicMaterial( { color, toneMapped: false } ) );

		this.object = object;
		this.size = size;
		this.type = 'VertexNormalsHelper';

		this.matrixAutoUpdate = false;

		this.update();

	}

	update() {

		this.object.updateMatrixWorld( true );

		_normalMatrix.getNormalMatrix( this.object.matrixWorld );

		const matrixWorld = this.object.matrixWorld;

		const position = this.geometry.attributes.position;

		//

		const objGeometry = this.object.geometry;

		if ( objGeometry ) {

			const objPos = objGeometry.attributes.position;

			const objNorm = objGeometry.attributes.normal;

			let idx = 0;

			// for simplicity, ignore index and drawcalls, and render every normal

			for ( let j = 0, jl = objPos.count; j < jl; j ++ ) {

				_v1.fromBufferAttribute( objPos, j ).applyMatrix4( matrixWorld );

				_v2.fromBufferAttribute( objNorm, j );

				_v2.applyMatrix3( _normalMatrix ).normalize().multiplyScalar( this.size ).add( _v1 );

				position.setXYZ( idx, _v1.x, _v1.y, _v1.z );

				idx = idx + 1;

				position.setXYZ( idx, _v2.x, _v2.y, _v2.z );

				idx = idx + 1;

			}

		}

		position.needsUpdate = true;

	}

	dispose() {

		this.geometry.dispose();
		this.material.dispose();

	}

}

THREE.VertexNormalsHelper = VertexNormalsHelper;

// =====================================================
// /playground/svoxcompleter.js
// =====================================================

// The keywords and values for the example syntax highligter in the documentation
SVOX.allKeywords = [];
SVOX.allValues   = [];

// The SVOX language completer for the ACE Editor
SVOX.completerTree = _fillCompleterTree();

function _fillCompleterTree() {
  let completerTree = [];
  _addDefinitionsToCompleterTree(completerTree, 'voxels',   '\r\n',                       { }                     , 'The voxel matrix is built up as stacked layers.');
  _addDefinitionsToCompleterTree(completerTree, 'texture',  ' ',                          SVOX.TEXTUREDEFINITIONS , 'Load a texture via the playground menu.');
  _addDefinitionsToCompleterTree(completerTree, 'light',    ' color = #FFF, intensity = 1', SVOX.LIGHTDEFINITIONS   , 'An ambient, directional or positional light for light baking.');
  _addDefinitionsToCompleterTree(completerTree, 'model',    '\r\nsize = 10 10 10\r\n',   SVOX.MODELDEFINITIONS   , 'The model itself, can only appear once!');
  _addDefinitionsToCompleterTree(completerTree, 'group',    ' id = ',                      SVOX.GROUPDEFINITIONS   , 'Groups allow for complex models by rotating, scaling and shaping partial models.');
  _addDefinitionsToCompleterTree(completerTree, 'material', ' lighting = flat, type = standard\r\n  colors = V:#F40', SVOX.MATERIALDEFINITIONS, 'Materials determine what the voxels look like.');
  
  SVOX.allKeywords.sort().reverse();
  SVOX.allValues.sort().reverse();
  
  return completerTree;
}

function _addDefinitionsToCompleterTree(tree, typeName, completion, definitions, typeDoc) {
  if(!SVOX.allKeywords.includes(typeName))
    SVOX.allKeywords.push(typeName);
  
  // First add the main keywords
  let mainDef = {
      caption: typeName,
      value:   typeName,
      score:   10,
      snippet: typeName + completion,
      docHTML: typeDoc,
      meta: 'Main keyword',
      properties:[]
    };

  let meta = ''
  for (const property in definitions) {
    let def = definitions[property];
    let propName = property.toLowerCase();
    
    // Use the headers from the cheat sheet as meta info
    if (property.startsWith('_')) {
      meta = def.doc;
      continue;
    }

    if(!SVOX.allKeywords.includes(propName))
      SVOX.allKeywords.push(propName);    
    
    // Add the allowed values and optionally allowed materials to the documentation
    let doc = def.doc;
    doc = doc + `<br><br>${def.values?'Allowed values: ':'Format: '}${_htmlEscape(def.format)}`
    if (def.allowedFor) {
      doc = doc + (def.allowedFor ? "<br><br>" + def.allowedFor : "")          
    }
    
    // Now add the property definition
    let propertyDef = 
    {
      caption: propName,
      value:   propName,
      score:   5,
      snippet: propName + ' = ' + (def.completion ?? ''),
      docHTML: doc,
      meta: meta,
    };
    
    // In case of allowed values for this property, add them as well
    if (def.values) {
      propertyDef.values = [];
      for (let v=0; v<def.values.length; v++) {
        let value = def.values[v].toLowerCase();
        
        if(!SVOX.allValues.includes(value) && !/\d/.test(value)) // Skip numbers
          SVOX.allValues.push(value);    
        
        propertyDef.values.push({
          caption: value,
          value:   value,
          score:   1,
          snippet: value,
          docHTML: doc,
          meta: property
        });
      }
    }
    
    mainDef.properties.push(propertyDef);
  }
  tree.push(mainDef);
}

function _htmlEscape(str) {
  return str
      .replace(/&/g, '&amp')
      .replace(/>/g, '&gt')   
      .replace(/</g, '&lt') 
      .replace(/\n/g, '<br>');  
}     

function _getWords(editor, session, pos, prefix) {
  // We'll be looking at what is in the file up to this point so chop off everyting after the cursor position
  let index = editor.session.doc.positionToIndex(pos);
  let text = editor.getValue().slice(0, index).toLowerCase();
  let line = '';

  // Find the main keywords except in a comment (repeating the look behind for comment is much(!) faster)
  let keywordMatch = /((?<!^.*\/\/.*)\btexture\b|(?<!^.*\/\/.*)\blight\b|(?<!^.*\/\/.*)\bgroup(?!\s*=)\b|(?<!^.*\/\/.*)\bmaterial\b|(?<!^.*\/\/.*)\bmodel\b|(?<!^.*\/\/.*)\bvoxels\b)/gm;
  let mainKeywords = [];
  let match;
  while (match = keywordMatch.exec(text)) {
    mainKeywords.push(match);
  };

  // The last main keyword determines whoch properties can occur (e.g. a material has different properties than a group)
  let mainKeyWord = null;
  let mainPos = -1; 
  if (mainKeywords.length > 0) {
    let match = mainKeywords[mainKeywords.length-1]; 
    mainKeyWord = match[0];
    mainPos = match.index;
    line = text.slice(mainPos);
    
    // In the voxel section turn off auto completion
    if (mainKeyWord === 'voxels') {
      return null;
    }
  }
  
  // Main keywords should only appear at the start of a line (or start of the model), so match them depending on the text on that line
  let startOfLine = line.trimStart().match(/^[A-Za-z]*$|(?<=\n)[A-Za-z]*$/)?.[0].toLowerCase();
  let mainKeyWords = SVOX.completerTree.filter(m=>m.caption.startsWith(startOfLine));
  
  let lastProperty = (line.trim().match(/\b([A-Za-z]+)\b\s*=\s*$/)?.[1] ?? '').toLowerCase();
  if (lastProperty) {
    // We are behind a '<property> =' show return only the values for this property
    return SVOX.completerTree.find(t=>t.caption === mainKeyWord)?.properties.find(p=>p.caption === lastProperty)?.values;
  }
  else {
    // Return all properties for this main keyword
    return mainKeyWords.concat(SVOX.completerTree.filter(t => t.caption === mainKeyWord)
    ?.[0]?.properties?.map(function (property) {
      
      // If this property is already used, don't show it again (properties can only appear once per main keyword)
      if (line.indexOf(property.value) > -1) {
        return null;
      }
      else {
        return property;
      }
      
    }).filter(w => w));
  }
};

// Construct the SVOX language completer for the ACE Editor
var svoxCompleter = {
  getCompletions: (editor, session, pos, prefix, callback) => {   	
    callback(
      null,
      _getWords(editor, session, pos, prefix)
    )
  }
}
