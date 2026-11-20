export function sendSuccess(res, { statusCode = 200, data = null, meta = null, message = null }) {
  const payload = {
    success: true,
    ...(message ? { message } : {}),
    data,
    ...(meta ? { meta } : {}),
  };

  return res.status(statusCode).json(payload);
}