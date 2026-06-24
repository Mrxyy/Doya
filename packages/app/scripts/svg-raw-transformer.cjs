const upstreamTransformer = require("@expo/metro-config/babel-transformer");

function transform({ filename, options, src }) {
  if (filename.endsWith(".svg")) {
    return upstreamTransformer.transform({
      filename: `${filename}.js`,
      options,
      src: `module.exports = ${JSON.stringify(src)};`,
    });
  }

  return upstreamTransformer.transform({ filename, options, src });
}

module.exports = { transform };
