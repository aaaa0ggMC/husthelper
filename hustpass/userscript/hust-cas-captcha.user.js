// ==UserScript==
// @name         HUST CAS 验证码自动识别
// @namespace    husthelper
// @version      1.0.0
// @description  在 pass.hust.edu.cn 登录页离线识别验证码并填入；账号密码已填好且把握足够时可自动登录。数据不出浏览器。
// @match        https://pass.hust.edu.cn/cas/login*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @license      LGPL-3.0-or-later
// ==/UserScript==
/*
 * 识别算法与数字模板移植自 xuxinhang/HUST-CAS-login-emulator（LGPL-3.0），经 husthelper/hustpass/stdchar。
 * 本文件由 hustpass/userscript/build.mjs 生成，请改 src/ 后重新构建。
 */
"use strict";
(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // ../node_modules/.pnpm/js-binary-schema-parser@2.0.3/node_modules/js-binary-schema-parser/lib/index.js
  var require_lib = __commonJS({
    "../node_modules/.pnpm/js-binary-schema-parser@2.0.3/node_modules/js-binary-schema-parser/lib/index.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports.loop = exports.conditional = exports.parse = void 0;
      var parse = function parse2(stream, schema) {
        var result = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {};
        var parent = arguments.length > 3 && arguments[3] !== void 0 ? arguments[3] : result;
        if (Array.isArray(schema)) {
          schema.forEach(function(partSchema) {
            return parse2(stream, partSchema, result, parent);
          });
        } else if (typeof schema === "function") {
          schema(stream, result, parent, parse2);
        } else {
          var key = Object.keys(schema)[0];
          if (Array.isArray(schema[key])) {
            parent[key] = {};
            parse2(stream, schema[key], result, parent[key]);
          } else {
            parent[key] = schema[key](stream, result, parent, parse2);
          }
        }
        return result;
      };
      exports.parse = parse;
      var conditional = function conditional2(schema, conditionFunc) {
        return function(stream, result, parent, parse2) {
          if (conditionFunc(stream, result, parent)) {
            parse2(stream, schema, result, parent);
          }
        };
      };
      exports.conditional = conditional;
      var loop = function loop2(schema, continueFunc) {
        return function(stream, result, parent, parse2) {
          var arr = [];
          var lastStreamPos = stream.pos;
          while (continueFunc(stream, result, parent)) {
            var newParent = {};
            parse2(stream, schema, result, newParent);
            if (stream.pos === lastStreamPos) {
              break;
            }
            lastStreamPos = stream.pos;
            arr.push(newParent);
          }
          return arr;
        };
      };
      exports.loop = loop;
    }
  });

  // ../node_modules/.pnpm/js-binary-schema-parser@2.0.3/node_modules/js-binary-schema-parser/lib/parsers/uint8.js
  var require_uint8 = __commonJS({
    "../node_modules/.pnpm/js-binary-schema-parser@2.0.3/node_modules/js-binary-schema-parser/lib/parsers/uint8.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports.readBits = exports.readArray = exports.readUnsigned = exports.readString = exports.peekBytes = exports.readBytes = exports.peekByte = exports.readByte = exports.buildStream = void 0;
      var buildStream = function buildStream2(uint8Data) {
        return {
          data: uint8Data,
          pos: 0
        };
      };
      exports.buildStream = buildStream;
      var readByte = function readByte2() {
        return function(stream) {
          return stream.data[stream.pos++];
        };
      };
      exports.readByte = readByte;
      var peekByte = function peekByte2() {
        var offset = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : 0;
        return function(stream) {
          return stream.data[stream.pos + offset];
        };
      };
      exports.peekByte = peekByte;
      var readBytes = function readBytes2(length) {
        return function(stream) {
          return stream.data.subarray(stream.pos, stream.pos += length);
        };
      };
      exports.readBytes = readBytes;
      var peekBytes = function peekBytes2(length) {
        return function(stream) {
          return stream.data.subarray(stream.pos, stream.pos + length);
        };
      };
      exports.peekBytes = peekBytes;
      var readString = function readString2(length) {
        return function(stream) {
          return Array.from(readBytes(length)(stream)).map(function(value) {
            return String.fromCharCode(value);
          }).join("");
        };
      };
      exports.readString = readString;
      var readUnsigned = function readUnsigned2(littleEndian) {
        return function(stream) {
          var bytes = readBytes(2)(stream);
          return littleEndian ? (bytes[1] << 8) + bytes[0] : (bytes[0] << 8) + bytes[1];
        };
      };
      exports.readUnsigned = readUnsigned;
      var readArray = function readArray2(byteSize, totalOrFunc) {
        return function(stream, result, parent) {
          var total = typeof totalOrFunc === "function" ? totalOrFunc(stream, result, parent) : totalOrFunc;
          var parser = readBytes(byteSize);
          var arr = new Array(total);
          for (var i = 0; i < total; i++) {
            arr[i] = parser(stream);
          }
          return arr;
        };
      };
      exports.readArray = readArray;
      var subBitsTotal = function subBitsTotal2(bits, startIndex, length) {
        var result = 0;
        for (var i = 0; i < length; i++) {
          result += bits[startIndex + i] && Math.pow(2, length - i - 1);
        }
        return result;
      };
      var readBits = function readBits2(schema) {
        return function(stream) {
          var _byte = readByte()(stream);
          var bits = new Array(8);
          for (var i = 0; i < 8; i++) {
            bits[7 - i] = !!(_byte & 1 << i);
          }
          return Object.keys(schema).reduce(function(res, key) {
            var def = schema[key];
            if (def.length) {
              res[key] = subBitsTotal(bits, def.index, def.length);
            } else {
              res[key] = bits[def.index];
            }
            return res;
          }, {});
        };
      };
      exports.readBits = readBits;
    }
  });

  // ../node_modules/.pnpm/js-binary-schema-parser@2.0.3/node_modules/js-binary-schema-parser/lib/schemas/gif.js
  var require_gif = __commonJS({
    "../node_modules/.pnpm/js-binary-schema-parser@2.0.3/node_modules/js-binary-schema-parser/lib/schemas/gif.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports["default"] = void 0;
      var _ = require_lib();
      var _uint = require_uint8();
      var subBlocksSchema = {
        blocks: function blocks(stream) {
          var terminator = 0;
          var chunks = [];
          var streamSize = stream.data.length;
          var total = 0;
          for (var size = (0, _uint.readByte)()(stream); size !== terminator; size = (0, _uint.readByte)()(stream)) {
            if (!size) break;
            if (stream.pos + size >= streamSize) {
              var availableSize = streamSize - stream.pos;
              chunks.push((0, _uint.readBytes)(availableSize)(stream));
              total += availableSize;
              break;
            }
            chunks.push((0, _uint.readBytes)(size)(stream));
            total += size;
          }
          var result = new Uint8Array(total);
          var offset = 0;
          for (var i = 0; i < chunks.length; i++) {
            result.set(chunks[i], offset);
            offset += chunks[i].length;
          }
          return result;
        }
      };
      var gceSchema = (0, _.conditional)({
        gce: [{
          codes: (0, _uint.readBytes)(2)
        }, {
          byteSize: (0, _uint.readByte)()
        }, {
          extras: (0, _uint.readBits)({
            future: {
              index: 0,
              length: 3
            },
            disposal: {
              index: 3,
              length: 3
            },
            userInput: {
              index: 6
            },
            transparentColorGiven: {
              index: 7
            }
          })
        }, {
          delay: (0, _uint.readUnsigned)(true)
        }, {
          transparentColorIndex: (0, _uint.readByte)()
        }, {
          terminator: (0, _uint.readByte)()
        }]
      }, function(stream) {
        var codes = (0, _uint.peekBytes)(2)(stream);
        return codes[0] === 33 && codes[1] === 249;
      });
      var imageSchema = (0, _.conditional)({
        image: [{
          code: (0, _uint.readByte)()
        }, {
          descriptor: [{
            left: (0, _uint.readUnsigned)(true)
          }, {
            top: (0, _uint.readUnsigned)(true)
          }, {
            width: (0, _uint.readUnsigned)(true)
          }, {
            height: (0, _uint.readUnsigned)(true)
          }, {
            lct: (0, _uint.readBits)({
              exists: {
                index: 0
              },
              interlaced: {
                index: 1
              },
              sort: {
                index: 2
              },
              future: {
                index: 3,
                length: 2
              },
              size: {
                index: 5,
                length: 3
              }
            })
          }]
        }, (0, _.conditional)({
          lct: (0, _uint.readArray)(3, function(stream, result, parent) {
            return Math.pow(2, parent.descriptor.lct.size + 1);
          })
        }, function(stream, result, parent) {
          return parent.descriptor.lct.exists;
        }), {
          data: [{
            minCodeSize: (0, _uint.readByte)()
          }, subBlocksSchema]
        }]
      }, function(stream) {
        return (0, _uint.peekByte)()(stream) === 44;
      });
      var textSchema = (0, _.conditional)({
        text: [{
          codes: (0, _uint.readBytes)(2)
        }, {
          blockSize: (0, _uint.readByte)()
        }, {
          preData: function preData(stream, result, parent) {
            return (0, _uint.readBytes)(parent.text.blockSize)(stream);
          }
        }, subBlocksSchema]
      }, function(stream) {
        var codes = (0, _uint.peekBytes)(2)(stream);
        return codes[0] === 33 && codes[1] === 1;
      });
      var applicationSchema = (0, _.conditional)({
        application: [{
          codes: (0, _uint.readBytes)(2)
        }, {
          blockSize: (0, _uint.readByte)()
        }, {
          id: function id(stream, result, parent) {
            return (0, _uint.readString)(parent.blockSize)(stream);
          }
        }, subBlocksSchema]
      }, function(stream) {
        var codes = (0, _uint.peekBytes)(2)(stream);
        return codes[0] === 33 && codes[1] === 255;
      });
      var commentSchema = (0, _.conditional)({
        comment: [{
          codes: (0, _uint.readBytes)(2)
        }, subBlocksSchema]
      }, function(stream) {
        var codes = (0, _uint.peekBytes)(2)(stream);
        return codes[0] === 33 && codes[1] === 254;
      });
      var schema = [
        {
          header: [{
            signature: (0, _uint.readString)(3)
          }, {
            version: (0, _uint.readString)(3)
          }]
        },
        {
          lsd: [{
            width: (0, _uint.readUnsigned)(true)
          }, {
            height: (0, _uint.readUnsigned)(true)
          }, {
            gct: (0, _uint.readBits)({
              exists: {
                index: 0
              },
              resolution: {
                index: 1,
                length: 3
              },
              sort: {
                index: 4
              },
              size: {
                index: 5,
                length: 3
              }
            })
          }, {
            backgroundColorIndex: (0, _uint.readByte)()
          }, {
            pixelAspectRatio: (0, _uint.readByte)()
          }]
        },
        (0, _.conditional)({
          gct: (0, _uint.readArray)(3, function(stream, result) {
            return Math.pow(2, result.lsd.gct.size + 1);
          })
        }, function(stream, result) {
          return result.lsd.gct.exists;
        }),
        // content frames
        {
          frames: (0, _.loop)([gceSchema, applicationSchema, commentSchema, imageSchema, textSchema], function(stream) {
            var nextCode = (0, _uint.peekByte)()(stream);
            return nextCode === 33 || nextCode === 44;
          })
        }
      ];
      var _default = schema;
      exports["default"] = _default;
    }
  });

  // ../node_modules/.pnpm/gifuct-js@2.1.2/node_modules/gifuct-js/lib/deinterlace.js
  var require_deinterlace = __commonJS({
    "../node_modules/.pnpm/gifuct-js@2.1.2/node_modules/gifuct-js/lib/deinterlace.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports.deinterlace = void 0;
      var deinterlace = function deinterlace2(pixels, width) {
        var newPixels = new Array(pixels.length);
        var rows = pixels.length / width;
        var cpRow = function cpRow2(toRow2, fromRow2) {
          var fromPixels = pixels.slice(fromRow2 * width, (fromRow2 + 1) * width);
          newPixels.splice.apply(newPixels, [toRow2 * width, width].concat(fromPixels));
        };
        var offsets = [0, 4, 2, 1];
        var steps = [8, 8, 4, 2];
        var fromRow = 0;
        for (var pass = 0; pass < 4; pass++) {
          for (var toRow = offsets[pass]; toRow < rows; toRow += steps[pass]) {
            cpRow(toRow, fromRow);
            fromRow++;
          }
        }
        return newPixels;
      };
      exports.deinterlace = deinterlace;
    }
  });

  // ../node_modules/.pnpm/gifuct-js@2.1.2/node_modules/gifuct-js/lib/lzw.js
  var require_lzw = __commonJS({
    "../node_modules/.pnpm/gifuct-js@2.1.2/node_modules/gifuct-js/lib/lzw.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports.lzw = void 0;
      var lzw = function lzw2(minCodeSize, data, pixelCount) {
        var MAX_STACK_SIZE = 4096;
        var nullCode = -1;
        var npix = pixelCount;
        var available, clear, code_mask, code_size, end_of_information, in_code, old_code, bits, code, i, datum, data_size, first, top, bi, pi;
        var dstPixels = new Array(pixelCount);
        var prefix = new Array(MAX_STACK_SIZE);
        var suffix = new Array(MAX_STACK_SIZE);
        var pixelStack = new Array(MAX_STACK_SIZE + 1);
        data_size = minCodeSize;
        clear = 1 << data_size;
        end_of_information = clear + 1;
        available = clear + 2;
        old_code = nullCode;
        code_size = data_size + 1;
        code_mask = (1 << code_size) - 1;
        for (code = 0; code < clear; code++) {
          prefix[code] = 0;
          suffix[code] = code;
        }
        var datum, bits, count, first, top, pi, bi;
        datum = bits = count = first = top = pi = bi = 0;
        for (i = 0; i < npix; ) {
          if (top === 0) {
            if (bits < code_size) {
              datum += data[bi] << bits;
              bits += 8;
              bi++;
              continue;
            }
            code = datum & code_mask;
            datum >>= code_size;
            bits -= code_size;
            if (code > available || code == end_of_information) {
              break;
            }
            if (code == clear) {
              code_size = data_size + 1;
              code_mask = (1 << code_size) - 1;
              available = clear + 2;
              old_code = nullCode;
              continue;
            }
            if (old_code == nullCode) {
              pixelStack[top++] = suffix[code];
              old_code = code;
              first = code;
              continue;
            }
            in_code = code;
            if (code == available) {
              pixelStack[top++] = first;
              code = old_code;
            }
            while (code > clear) {
              pixelStack[top++] = suffix[code];
              code = prefix[code];
            }
            first = suffix[code] & 255;
            pixelStack[top++] = first;
            if (available < MAX_STACK_SIZE) {
              prefix[available] = old_code;
              suffix[available] = first;
              available++;
              if ((available & code_mask) === 0 && available < MAX_STACK_SIZE) {
                code_size++;
                code_mask += available;
              }
            }
            old_code = in_code;
          }
          top--;
          dstPixels[pi++] = pixelStack[top];
          i++;
        }
        for (i = pi; i < npix; i++) {
          dstPixels[i] = 0;
        }
        return dstPixels;
      };
      exports.lzw = lzw;
    }
  });

  // ../node_modules/.pnpm/gifuct-js@2.1.2/node_modules/gifuct-js/lib/index.js
  var require_lib2 = __commonJS({
    "../node_modules/.pnpm/gifuct-js@2.1.2/node_modules/gifuct-js/lib/index.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports.decompressFrames = exports.decompressFrame = exports.parseGIF = void 0;
      var _gif = _interopRequireDefault(require_gif());
      var _jsBinarySchemaParser = require_lib();
      var _uint = require_uint8();
      var _deinterlace = require_deinterlace();
      var _lzw = require_lzw();
      function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : { "default": obj };
      }
      var parseGIF2 = function parseGIF3(arrayBuffer) {
        var byteData = new Uint8Array(arrayBuffer);
        return (0, _jsBinarySchemaParser.parse)((0, _uint.buildStream)(byteData), _gif["default"]);
      };
      exports.parseGIF = parseGIF2;
      var generatePatch = function generatePatch2(image) {
        var totalPixels = image.pixels.length;
        var patchData = new Uint8ClampedArray(totalPixels * 4);
        for (var i = 0; i < totalPixels; i++) {
          var pos = i * 4;
          var colorIndex = image.pixels[i];
          var color = image.colorTable[colorIndex] || [0, 0, 0];
          patchData[pos] = color[0];
          patchData[pos + 1] = color[1];
          patchData[pos + 2] = color[2];
          patchData[pos + 3] = colorIndex !== image.transparentIndex ? 255 : 0;
        }
        return patchData;
      };
      var decompressFrame = function decompressFrame2(frame, gct, buildImagePatch) {
        if (!frame.image) {
          console.warn("gif frame does not have associated image.");
          return;
        }
        var image = frame.image;
        var totalPixels = image.descriptor.width * image.descriptor.height;
        var pixels = (0, _lzw.lzw)(image.data.minCodeSize, image.data.blocks, totalPixels);
        if (image.descriptor.lct.interlaced) {
          pixels = (0, _deinterlace.deinterlace)(pixels, image.descriptor.width);
        }
        var resultImage = {
          pixels,
          dims: {
            top: frame.image.descriptor.top,
            left: frame.image.descriptor.left,
            width: frame.image.descriptor.width,
            height: frame.image.descriptor.height
          }
        };
        if (image.descriptor.lct && image.descriptor.lct.exists) {
          resultImage.colorTable = image.lct;
        } else {
          resultImage.colorTable = gct;
        }
        if (frame.gce) {
          resultImage.delay = (frame.gce.delay || 10) * 10;
          resultImage.disposalType = frame.gce.extras.disposal;
          if (frame.gce.extras.transparentColorGiven) {
            resultImage.transparentIndex = frame.gce.transparentColorIndex;
          }
        }
        if (buildImagePatch) {
          resultImage.patch = generatePatch(resultImage);
        }
        return resultImage;
      };
      exports.decompressFrame = decompressFrame;
      var decompressFrames2 = function decompressFrames3(parsedGif, buildImagePatches) {
        return parsedGif.frames.filter(function(f) {
          return f.image;
        }).map(function(f) {
          return decompressFrame(f, parsedGif.gct, buildImagePatches);
        });
      };
      exports.decompressFrames = decompressFrames2;
    }
  });

  // userscript/src/recognizer.js
  var import_gifuct_js = __toESM(require_lib2(), 1);

  // userscript/src/templates.js
  var TEMPLATE_WIDTH = 22;
  var TEMPLATE_HEIGHT = 58;
  var TEMPLATES_B64 = [
    "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEAAAAAAAEBAQEBAQEBAQEBAQEBAQAAAAAAAAAAAAEBAQEBAQEBAQEBAAAAAAAAAAAAAAAAAQEBAQEBAQEBAQAAAAABAQEBAAAAAAEBAQEBAQEBAQAAAAABAQEBAQEAAAAAAQEBAQEBAQAAAAABAQEBAQEBAAAAAAEBAQEBAQEAAAAAAQEBAQEBAQAAAAABAQEBAQEAAAAAAQEBAQEBAQEAAAAAAQEBAQEBAAAAAAEBAQEBAQEBAAAAAAEBAQEBAQAAAAABAQEBAQEBAQAAAAABAQEBAQEAAAAAAQEBAQEBAQEAAAAAAQEBAQEBAAAAAAEBAQEBAQEAAAAAAQEBAQEBAQAAAAEBAQEBAQEBAAAAAAEBAQEBAQEAAAABAQEBAQEBAQAAAAABAQEBAQEBAAAAAAEBAQEBAQAAAAABAQEBAQEBAQAAAAABAQEBAQEAAAAAAQEBAQEBAQEAAAAAAAEBAQAAAAAAAQEBAQEBAQEBAQAAAAAAAAAAAAAAAQEBAQEBAQEBAQEBAAAAAAAAAAAAAQEBAQEBAQEBAQEBAQEAAAAAAAABAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEAAQEBAQEBAQEBAQEBAQEBAQEBAQEAAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ==",
    "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEAAAEBAQEBAQEBAQEBAQEBAQEAAAAAAAABAQEBAQEBAQEBAQEBAQAAAAAAAAAAAQEBAQEBAQEBAQEBAQEAAAAAAAAAAAEBAQEBAQEBAQEBAQEBAAABAQAAAAABAQEBAQEBAQEBAQEBAQEBAQEAAAAAAQEBAQEBAQEBAQEBAQEBAQEAAAAAAQEBAQEBAQEBAQEBAQEBAQEBAAAAAAEBAQEBAQEBAQEBAQEBAQEBAQAAAAABAQEBAQEBAQEBAQEBAQEBAQEAAAAAAQEBAQEBAQEBAQEBAQEBAQEBAAAAAAEBAQEBAQEBAQEBAQEBAQEBAAAAAAEBAQEBAQEBAQEBAQEBAQEBAQAAAAABAQEBAQEBAQEBAQABAQEBAQEAAAAAAQEBAQEBAQEBAQEAAQEBAQEBAAAAAAEBAQEBAQEBAQEBAQEBAQEBAQAAAAABAQEBAQEBAQEBAQEBAQEBAQEAAAAAAQEBAQEBAQEBAQEBAQAAAAAAAAAAAAAAAAEBAQEBAQEBAQEAAAAAAAAAAAAAAAABAQEBAQEBAQEBAAAAAAAAAAAAAAAAAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ==",
    "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQAAAAAAAAEBAQEBAQEBAQEBAQEBAAAAAAAAAAAAAAEBAQEBAQEBAQEBAAAAAAAAAAAAAAABAQEBAQEBAQEBAQAAAQEBAQEAAAAAAAEBAQEBAQEBAQEBAQEBAQEBAAAAAAABAQEBAQEBAQEBAQEBAQEBAQEAAAAAAQEBAQEBAQEBAQEBAQEBAQEAAAAAAQEBAQEBAQEBAQEBAQEBAQEBAAAAAAEBAQEBAQEBAQEBAQEBAQEBAAAAAAEBAQEBAQEBAQEBAQEBAQEBAAAAAAEBAQEBAQEBAQEBAQEBAQEBAAAAAAEBAQEBAQEBAQEBAQEBAQEBAAAAAQEBAQEBAQEBAQEBAQEBAQEAAAAAAQEBAQEBAQEBAQEBAQEBAQEAAAAAAQEBAQEBAQEBAQEBAQEBAQEAAAAAAQEBAQEBAQEBAQEBAQEBAQEAAAAAAQEBAQEBAQEBAQEBAQEBAQEAAAAAAQEBAQEBAQEBAQEBAQEBAQEBAAAAAAAAAAAAAAAAAQEBAQEBAQEBAQAAAAAAAAAAAAAAAAEBAQEBAQEBAQEAAAAAAAAAAAAAAAABAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ==",
    "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEAAAAAAAAAAQEBAQEBAQEBAQEBAQAAAAAAAAAAAAAAAQEBAQEBAQEBAQEAAAAAAAAAAAAAAAABAQEBAQEBAQEBAAEBAQEBAQAAAAAAAQEBAQEBAQEBAQEBAQEBAQEBAAAAAAEBAQEBAQEBAQEBAQEBAQEBAAAAAAEBAQEBAQEBAQEBAQEBAQEBAQAAAAABAQEBAQEBAQEBAQEBAQEBAAAAAAABAQEBAQEBAQEBAQEBAAAAAAAAAAABAQEBAQEBAQEBAQEBAQAAAAAAAAABAQEBAQEBAQEBAQEBAQEAAAAAAAAAAAABAQEBAQEBAQEBAQEBAQEBAQAAAAAAAAEBAQEBAQEBAQEBAQEBAQEBAQAAAAABAQEBAQEBAQABAQEBAQEBAQEAAAAAAQEBAQEBAQEAAQEBAQEBAQEBAAAAAAEBAQEBAQEBAAEBAQEBAQEBAAAAAAABAQEBAQEBAQEAAQEBAQEBAAAAAAABAQEBAQEBAQEBAAAAAAAAAAAAAAABAQEBAQEBAQEBAQAAAAAAAAAAAAABAQEBAQEBAQEBAQEBAAAAAAAAAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ==",
    "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEAAAAAAQEBAQEBAQEBAQEBAQEBAQEAAAAAAAEBAQEBAQEBAQEBAQEBAQEAAAAAAAABAQEBAQEBAQEBAQEBAQEAAAAAAAAAAQEBAQEBAQEBAQEBAQEAAAABAAAAAAEBAQEBAQEBAQEBAQEAAAABAQAAAAABAQEBAQEBAQEBAQEAAAABAQAAAAABAQEBAQEBAQEBAQEAAAAAAQEAAAAAAQEBAQEBAQEBAQEBAAAAAQEBAAAAAAEBAQEBAQEBAQEBAAAAAQEBAQAAAAABAQEBAQEBAQEBAAAAAQEBAQEAAAAAAQEBAQEBAQEBAAAAAQEBAQEAAAAAAQEBAQEBAQEBAQAAAAAAAAAAAAAAAAAAAQEBAQEBAQEAAAAAAAAAAAAAAAAAAAEBAQEBAQEBAAAAAAAAAAAAAAAAAAABAQEBAQEBAQEBAQEBAQEBAAAAAAEBAQEBAQEBAQEBAQEBAQEBAQAAAAABAQEBAQEBAQEBAQEBAQEBAQAAAAABAQEBAQEBAQEBAAEBAQEBAQEAAAAAAQEBAQEBAQEBAQABAQEBAQEBAAAAAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ==",
    "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAAAAAAAAAAAAAAAAAAEBAQEBAQEBAQAAAAAAAAAAAAAAAAABAQEBAQEBAQEAAAAAAAAAAAAAAAAAAQEBAQEBAQEBAAAAAQEBAQEBAQEBAQEBAQEBAQEBAQAAAAEBAQEBAQEBAQEBAQEBAQEBAQEAAAABAQEBAQEBAQEBAQEBAQEBAQEAAAABAQEBAQEBAQEBAQEBAQEBAQEBAAAAAAAAAAABAQEBAQEBAQEBAQEBAQAAAAAAAAAAAAABAQEBAQEBAQEBAQEAAAAAAAAAAAAAAAEBAQEBAQEBAQEBAQEBAQEBAAAAAAAAAQEBAQEBAQEBAQEBAQEBAQEBAAAAAAEBAQEBAQEBAQEBAQEBAQEBAQAAAAABAQEBAQEBAQEBAQEBAQEBAQEAAAAAAQEBAQEBAQEBAQEBAQEBAQEBAAAAAAEBAQEBAQEBAQEBAQEBAQEBAAAAAAABAQEBAQEBAQEAAQEBAQEBAAAAAAABAQEBAQEBAQEBAAAAAAAAAAAAAAABAQEBAQEBAQEBAQAAAAAAAAAAAAABAQEBAQEBAQEBAQEBAAAAAAAAAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ==",
    "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAAAAAAAAAAEBAQEBAQEBAQEBAQAAAAAAAAAAAAAAAQEBAQEBAQEBAQAAAAAAAAAAAAAAAAEBAQEBAQEBAQAAAAAAAQEBAQEBAAABAQEBAQEBAQAAAAABAQEBAQEBAQEBAQEBAQEBAQAAAAAAAQEBAQEBAQEBAQEBAQEBAQEAAAAAAQEBAQEBAQEBAQEBAQEBAQEAAAAAAQEBAAAAAAABAQEBAQEBAQEBAAAAAAEAAAAAAAAAAAABAQEBAQEBAQAAAAAAAAAAAAAAAAAAAAEBAQEBAQEAAAAAAAEBAQEBAAAAAAABAQEBAQEBAAAAAAEBAQEBAQEAAAAAAQEBAQEBAQAAAAEBAQEBAQEBAAAAAAEBAQEBAQEAAAABAQEBAQEBAQAAAAABAQEBAQEBAAAAAQEBAQEBAQEAAAAAAQEBAQEBAQAAAAABAQEBAQEAAAAAAQEBAQEBAQEAAAAAAAEBAQEAAAAAAAEBAQEBAQEBAQAAAAAAAAAAAAAAAAEBAQEBAQEBAQEBAAAAAAAAAAAAAAEBAQEBAQEBAQEBAQEAAAAAAAAAAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ==",
    "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQAAAAAAAAAAAAAAAAAAAQEBAQEBAQEAAAAAAAAAAAAAAAAAAAEBAQEBAQEBAAAAAAAAAAAAAAAAAAABAQEBAQEBAQEBAQEBAQEBAQEAAAABAQEBAQEBAQEBAQEBAQEBAQEAAAABAQEBAQEBAQEBAQEBAQEBAQEBAAAAAQEBAQEBAQEBAQEBAQEBAQEBAAAAAQEBAQEBAQEBAQEBAQEBAQEBAAAAAQEBAQEBAQEBAQEBAQEBAQEBAAAAAQEBAQEBAQEBAQEBAQEBAQEBAAAAAQEBAQEBAQEBAQEBAQEBAQEBAAAAAQEBAQEBAQEBAQEBAQEBAQEBAAAAAQEBAQEBAQEBAQEBAQEBAQEBAQAAAAEBAQEBAQEBAQEBAQEBAQEBAQAAAAEBAQEBAQEBAQEBAQEBAQEBAQAAAAEBAQEBAQEBAQEBAQEBAQEBAQAAAAABAQEBAQEBAQEBAQEBAQEBAQEAAAABAQEBAQEBAQEBAQEBAQEBAQEAAAAAAQEBAQEBAQEBAQEBAQEBAAEBAAAAAQEBAQEBAQEBAQEBAQEBAQABAAAAAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ==",
    "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEAAAAAAAABAQEBAQEBAQEBAQEBAQAAAAAAAAAAAAEBAQEBAQEBAQEBAQAAAAAAAAAAAAAAAQEBAQEBAQEBAQAAAAABAQEAAAAAAAEBAQEBAQEBAQEAAAAAAQEBAQAAAAABAQEBAQEBAQEBAAAAAAEBAQEAAAABAQEBAQEBAQEBAQAAAAAAAQEAAAAAAQEBAQEBAQEBAQEAAAAAAAAAAAAAAQEBAQEBAQEBAQEBAQAAAAAAAAAAAQEBAQEBAQEBAQEBAQEAAAAAAAAAAAEBAQEBAQEBAQEBAQEAAAAAAAAAAAAAAQEBAQEBAQEBAQEAAAABAQAAAAAAAAABAQEBAQEBAQEAAAAAAQEBAQAAAAAAAQEBAQEBAQEAAAAAAQEBAQEBAAAAAAEBAQEBAQEBAAAAAAEBAQEBAQAAAAABAQEBAQEBAQAAAAABAQEBAQEAAAAAAQEBAQEBAQEAAAAAAAEBAQEAAAAAAQEBAQEBAQEBAAAAAAAAAAAAAAAAAQEBAQEBAQEBAAEAAAAAAAAAAAAAAQEBAQEBAQEBAQABAQEAAAAAAAABAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ==",
    "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQAAAAAAAAEBAQEBAQEBAQEBAQEBAAAAAAAAAAAAAAEBAQEBAQEBAQEBAAAAAAAAAAAAAAAAAQEBAQEBAQEBAAAAAAEBAQEBAAAAAAEBAQEBAQEBAAAAAAEBAQEBAQEAAAAAAQEBAQEBAQAAAAABAQEBAQEBAAAAAAEBAQEAAQAAAAABAQEBAQEBAQAAAAABAQEBAQEAAAAAAQEBAQEBAQEAAAAAAQEBAQEBAAAAAAABAQEBAQEAAAAAAAEBAQEBAQAAAAAAAAEBAQEAAAAAAAABAQEBAQEBAAAAAAAAAAAAAAEAAAAAAQEBAQEBAQEAAAAAAAAAAAEAAAAAAQEBAQEBAQEBAQAAAAAAAAEBAAAAAAEBAQEBAQABAQEBAQEBAQEBAQAAAAABAQEBAQEAAQEBAQEBAQEBAQAAAAABAQEBAQEBAQEBAQEBAQEBAQAAAAABAQEBAQEBAQEAAQEBAQEBAAAAAAAAAQEBAQEBAQEBAAAAAAAAAAAAAAABAQEBAQEBAQEBAQAAAAAAAAAAAAABAQEBAQEBAQEBAQEBAAAAAAAAAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ=="
  ];

  // userscript/src/recognizer.js
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  var templates;
  function getTemplates() {
    templates ??= TEMPLATES_B64.map((b64, digit) => ({ char: String(digit), data: b64ToBytes(b64) }));
    return templates;
  }
  function decodeGifFrames(buffer) {
    const parsed = (0, import_gifuct_js.parseGIF)(buffer);
    const frames = (0, import_gifuct_js.decompressFrames)(parsed, true);
    const width = parsed.lsd.width;
    const height = parsed.lsd.height;
    if (frames.length === 0) throw new Error("GIF \u4E0D\u5305\u542B\u4EFB\u4F55\u5E27");
    const rendered = [];
    let canvas = new Uint8ClampedArray(width * height * 4);
    for (const frame of frames) {
      const before = canvas.slice();
      const { top, left, width: fw, height: fh } = frame.dims;
      for (let y = 0; y < fh; y++) {
        for (let x = 0; x < fw; x++) {
          const s = (y * fw + x) * 4;
          const alpha = frame.patch[s + 3] / 255;
          if (alpha === 0) continue;
          const t = ((top + y) * width + (left + x)) * 4;
          const destAlpha = canvas[t + 3] / 255;
          const outAlpha = alpha + destAlpha * (1 - alpha);
          for (let c = 0; c < 3; c++) {
            const src = frame.patch[s + c] * alpha;
            const dst = canvas[t + c] * destAlpha * (1 - alpha);
            canvas[t + c] = outAlpha === 0 ? 0 : (src + dst) / outAlpha;
          }
          canvas[t + 3] = outAlpha * 255;
        }
      }
      rendered.push({ width, height, data: canvas.slice() });
      if (frame.disposalType === 2) {
        for (let y = 0; y < fh; y++) {
          for (let x = 0; x < fw; x++) {
            const t = ((top + y) * width + (left + x)) * 4;
            canvas[t] = canvas[t + 1] = canvas[t + 2] = canvas[t + 3] = 0;
          }
        }
      } else if (frame.disposalType === 3) canvas = before;
    }
    return rendered;
  }
  function otsu(values) {
    const histogram = new Array(256).fill(0);
    for (let i = 0; i < values.length; i++) histogram[values[i]]++;
    const total = values.length;
    let sum = 0;
    for (let t = 0; t < 256; t++) sum += t * histogram[t];
    let sumLow = 0;
    let countLow = 0;
    let best = 0;
    let bestVariance = -1;
    for (let t = 0; t < 256; t++) {
      countLow += histogram[t];
      if (countLow === 0) continue;
      const countHigh = total - countLow;
      if (countHigh === 0) break;
      sumLow += t * histogram[t];
      const meanLow = sumLow / countLow;
      const meanHigh = (sum - sumLow) / countHigh;
      const variance = countLow * countHigh * (meanHigh - meanLow) ** 2;
      if (variance > bestVariance) {
        bestVariance = variance;
        best = t;
      }
    }
    return best;
  }
  function binarize(values, threshold, maxValue) {
    const out = new Uint8Array(values.length);
    for (let i = 0; i < values.length; i++) out[i] = values[i] > threshold ? maxValue : 0;
    return out;
  }
  function sampleStrip(image, imageWidth, imageHeight, startX, stripWidth, tw, th) {
    const out = new Uint8Array(tw * th);
    for (let y = 0; y < th; y++) {
      const sy = Math.min(imageHeight - 1, Math.floor(y / th * imageHeight));
      for (let x = 0; x < tw; x++) {
        const ox = Math.min(stripWidth - 1, Math.floor(x / tw * stripWidth));
        out[y * tw + x] = image[sy * imageWidth + startX + ox];
      }
    }
    return out;
  }
  function recognizeFrames(frames) {
    if (frames.length === 0) throw new Error("\u6CA1\u6709\u53EF\u7528\u4E8E\u8BC6\u522B\u7684\u5E27");
    const tpls = getTemplates();
    const { width, height } = frames[0];
    const planes = [];
    for (const frame of frames) {
      for (let channel = 0; channel < 3; channel++) {
        const plane = new Uint8Array(width * height);
        for (let i = 0; i < width * height; i++) plane[i] = frame.data[i * 4 + channel];
        planes.push(binarize(plane, otsu(plane), 255));
      }
    }
    const averaged = new Float64Array(width * height);
    for (const plane of planes) for (let i = 0; i < averaged.length; i++) averaged[i] += plane[i];
    for (let i = 0; i < averaged.length; i++) averaged[i] /= planes.length;
    const rounded = Uint8Array.from(averaged, (v) => Math.round(v));
    const bitmap = binarize(rounded, otsu(rounded), 1);
    const stripWidth = Math.floor(width / 4);
    let code = "";
    const margins = [];
    for (let s = 0; s < 4; s++) {
      const strip = sampleStrip(bitmap, width, height, s * stripWidth, stripWidth, TEMPLATE_WIDTH, TEMPLATE_HEIGHT);
      let bestChar = "?";
      let best = Infinity;
      let second = Infinity;
      for (const t of tpls) {
        let d = 0;
        for (let i = 0; i < strip.length; i++) d += strip[i] ^ t.data[i];
        if (d < best) {
          second = best;
          best = d;
          bestChar = t.char;
        } else if (d < second) second = d;
      }
      code += bestChar;
      margins.push(second - best);
    }
    return { code, margins };
  }
  function recognizeGif(buffer) {
    return recognizeFrames(decodeGifFrames(buffer));
  }

  // userscript/src/main.js
  var MIN_MARGIN = 40;
  var MAX_TRIES = 4;
  var AUTO_SUBMIT_COOLDOWN_MS = 12e4;
  var AUTOFILL_WAIT_MS = 1200;
  var KEY_AUTO = "autoSubmit";
  var KEY_LAST_SUBMIT = "lastAutoSubmitAt";
  var store = {
    get(key, fallback) {
      try {
        return typeof GM_getValue === "function" ? GM_getValue(key, fallback) : fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        if (typeof GM_setValue === "function") GM_setValue(key, value);
      } catch {
      }
    }
  };
  var $ = (id) => document.getElementById(id);
  var badge;
  function say(text, kind = "info") {
    if (!badge) {
      badge = document.createElement("div");
      Object.assign(badge.style, {
        position: "fixed",
        right: "16px",
        bottom: "16px",
        zIndex: 2147483647,
        padding: "8px 14px",
        borderRadius: "8px",
        font: "13px/1.4 system-ui, sans-serif",
        color: "#fff",
        boxShadow: "0 2px 10px rgba(0,0,0,.25)",
        transition: "opacity .3s"
      });
      document.body.appendChild(badge);
    }
    badge.textContent = text;
    badge.style.background = kind === "ok" ? "#2e7d32" : kind === "warn" ? "#ef6c00" : "#37474f";
    badge.style.opacity = "1";
    clearTimeout(say.timer);
    say.timer = setTimeout(() => badge.style.opacity = "0", kind === "info" ? 8e3 : 3500);
  }
  var busy = false;
  async function fetchCaptcha() {
    const res = await fetch(`/cas/code?${Math.random()}`, { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) throw new Error(`\u9A8C\u8BC1\u7801\u8BF7\u6C42\u5931\u8D25\uFF1AHTTP ${res.status}`);
    return res.arrayBuffer();
  }
  function setImage(img, bytes) {
    if (img.dataset.blobUrl) URL.revokeObjectURL(img.dataset.blobUrl);
    const url = URL.createObjectURL(new Blob([bytes], { type: "image/gif" }));
    img.dataset.blobUrl = url;
    img.src = url;
  }
  function fillCode(code) {
    const input = $("code");
    input.value = code;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  async function solve() {
    if (busy) return { ok: false };
    busy = true;
    const img = $("codeImage");
    const t0 = performance.now();
    try {
      let last;
      for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
        const bytes = await fetchCaptcha();
        last = recognizeGif(bytes);
        setImage(img, bytes);
        const minMargin = Math.min(...last.margins);
        if (minMargin >= MIN_MARGIN) {
          fillCode(last.code);
          say(`\u9A8C\u8BC1\u7801 ${last.code}\uFF08${Math.round(performance.now() - t0)}ms\uFF09`, "ok");
          return { ok: true, confident: true };
        }
        say(`\u9A8C\u8BC1\u7801\u628A\u63E1\u4E0D\u8DB3\uFF08${minMargin}\uFF09\uFF0C\u6362\u4E00\u5F20\u2026\uFF08${attempt}/${MAX_TRIES}\uFF09`, "warn");
      }
      fillCode(last.code);
      say(`\u9A8C\u8BC1\u7801 ${last.code}\uFF08\u628A\u63E1\u8F83\u4F4E\uFF0C\u8BF7\u786E\u8BA4\u540E\u518D\u767B\u5F55\uFF09`, "warn");
      return { ok: true, confident: false };
    } catch (error) {
      say(`\u9A8C\u8BC1\u7801\u8BC6\u522B\u5931\u8D25\uFF1A${error instanceof Error ? error.message : error}`, "warn");
      return { ok: false };
    } finally {
      busy = false;
    }
  }
  function hasVisibleError() {
    const box = $("errormsg");
    if (!box) return false;
    const shown = getComputedStyle(box).display !== "none";
    return shown && box.textContent.trim().length > 0;
  }
  async function waitForAutofill() {
    const deadline = Date.now() + AUTOFILL_WAIT_MS;
    while (Date.now() < deadline) {
      if ($("un")?.value && $("pd")?.value) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return Boolean($("un")?.value && $("pd")?.value);
  }
  async function maybeSubmit(confident) {
    if (!store.get(KEY_AUTO, true)) return;
    if (!confident) return;
    if (hasVisibleError()) return say("\u9875\u9762\u63D0\u793A\u4E86\u9519\u8BEF\uFF0C\u672A\u81EA\u52A8\u767B\u5F55", "warn");
    if (Date.now() - Number(store.get(KEY_LAST_SUBMIT, 0)) < AUTO_SUBMIT_COOLDOWN_MS) {
      return say("\u521A\u81EA\u52A8\u767B\u5F55\u8FC7\uFF0C\u672C\u6B21\u8BF7\u624B\u52A8\u70B9\u51FB\u767B\u5F55\uFF08\u9632\u6B62\u8FDE\u7EED\u5931\u8D25\u9501\u5B9A\u8D26\u53F7\uFF09", "info");
    }
    if (!await waitForAutofill()) return;
    store.set(KEY_LAST_SUBMIT, Date.now());
    say("\u81EA\u52A8\u767B\u5F55\u4E2D\u2026", "info");
    $("index_login_btn")?.click();
  }
  function registerMenu() {
    if (typeof GM_registerMenuCommand !== "function") return;
    const on = store.get(KEY_AUTO, true);
    GM_registerMenuCommand(`\u81EA\u52A8\u767B\u5F55\uFF1A${on ? "\u5F00\uFF08\u70B9\u51FB\u5173\u95ED\uFF09" : "\u5173\uFF08\u70B9\u51FB\u5F00\u542F\uFF09"}`, () => {
      store.set(KEY_AUTO, !on);
      location.reload();
    });
  }
  async function main() {
    if (!$("codeImage") || !$("code")) return;
    registerMenu();
    window.addEventListener(
      "click",
      (event) => {
        if (event.target?.id !== "codeImage") return;
        event.stopImmediatePropagation();
        event.preventDefault();
        void solve();
      },
      true
    );
    const result = await solve();
    if (result.ok) await maybeSubmit(result.confident);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void main());
  else void main();
})();
