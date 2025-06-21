export function mockAuth(req, res, next) {
    req.user = { id: 'netrunnerX', role: 'admin' }; // Hardcoded
    next();
  }