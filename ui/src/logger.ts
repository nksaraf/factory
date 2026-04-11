export default function plugin(app) {
  console.log(app)
  app.hooks.hook("request", (request) => {
    console.log(request.path)
  })

  app.hooks.hook("afterResponse", (response, { event }) => {
    console.log(event.path, response.statusCode)
  })
}
