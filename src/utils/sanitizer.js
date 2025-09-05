exports.sanitizeContent = (text) => {
  return text
    .replace(/[^\x20-\x7E\x0A\x0D\x09]/g, '') // Remove non-printable
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
};
