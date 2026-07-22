function notFound(req, res) {
  res.status(404).render('errors/404', { title: 'Página não encontrada' });
}

function errorHandler(err, req, res, next) {
  console.error(err);
  const status = err.status || 500;
  res.status(status).render('errors/500', {
    title: 'Algo deu errado',
    message: process.env.NODE_ENV === 'production' ? null : err.message,
  });
}

module.exports = { notFound, errorHandler };
