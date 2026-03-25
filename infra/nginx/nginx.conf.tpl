load_module modules/ngx_otel_module.so;

user  nginx;
worker_processes  auto;

error_log  /var/log/nginx/error.log notice;
pid        /var/run/nginx.pid;

events {
    worker_connections 1024;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    # --- OpenTelemetry ---
    otel_exporter {
        endpoint infra-clickstack-otel:4317;
        header "authorization" "__CLICKSTACK_API_KEY__";
        interval 5s;
        batch_size 512;
    }

    otel_service_name api-gateway;
    otel_trace on;
    otel_trace_context propagate;

    sendfile        on;
    keepalive_timeout  65;

    include /etc/nginx/conf.d/*.conf;
}
