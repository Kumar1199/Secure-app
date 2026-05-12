exports.default = async function(configuration) {
  // No-op Windows signing for local packaging without a certificate
  return true;
};
