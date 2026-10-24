# Seguridad de DM Comunicación Visual: puesta en marcha

## Qué queda preparado en el proyecto

- La migración `0011_admin_security.sql` conserva todas las cuentas existentes con acceso completo (`owner`), su contraseña, su estado y sus sesiones. No activa segundo factor.
- Las cuentas nuevas creadas desde el panel tienen permisos de operador por defecto. Se puede elegir acceso completo de forma explícita. El operador gestiona catálogo, pedidos, consultas y cupones; no administra usuarios ni ajustes, no consulta correo/auditoría ni confirma cobros manuales. Los pedidos que consulta incluyen información del cliente necesaria para trabajar.
- No se permite desactivar ni reducir permisos de la propia cuenta desde el panel. Debe permanecer un administrador activo con acceso completo.
- Un cambio real de contraseña, estado o rol invalida las sesiones del usuario afectado desde la base de datos, incluso si se hace por el script o por SQL. Instalar la migración no invalida las sesiones.
- Ajustes, administración de usuarios y confirmación de cobros requieren autenticación reciente (cinco minutos). Si hace falta, aparece un formulario con la contraseña actual y, solo si está activado, el segundo factor.
- Segundo factor opcional TOTP, cifrado en base de datos con AES-256-GCM, y diez códigos de recuperación de un solo uso almacenados como hashes. La activación exige verificar un código; las otras sesiones de esa cuenta se cierran y la actual permanece abierta.
- Límites de acceso persistentes por IP, registro de fallos por cuenta y demora adicional tras muchos fallos. Una contraseña correcta con su segundo factor no se rechaza por el contador de fallos de la cuenta: evita que un tercero bloquee la cuenta conociendo el correo. El límite por IP sí puede producir una espera de 15 minutos.
- Respuestas del admin con `Cache-Control: no-store`.
- Imágenes nuevas: máximo 4 MB y 25 megapíxeles; contenido decodificado, formato contrastado y conversión a WebP sin metadatos, hasta 3000 × 3000. Imágenes animadas se rechazan con explicación. Las imágenes ya publicadas y el logo no se modifican.
- Alertas de cambios de pagos, cambios de administradores, desactivación de MFA e intentos fallidos reiterados sobre cuentas existentes. Se limita a una alerta por clase cada 15 minutos; todos los eventos auditados siguen en la bitácora.

## 1. Antes del despliegue

1. Confirmá en Render cuál es el servicio y la base usados por la web. El archivo `render.yaml` propone PostgreSQL en Render y Supabase para imágenes; verificá que coincida con tu configuración real.
2. En la base de Render abrí **Recovery**. Confirmá que hay una recuperación disponible y guardá un export reciente en almacenamiento privado. La retención depende del plan: verificá la ventana mostrada en tu cuenta.
3. Conservá una sesión del panel abierta mientras verificás el despliegue.
4. Al publicar estos cambios, revisá que el despliegue ejecute `npm run migrate` antes de arrancar. El Blueprint ya define `preDeployCommand`; si el servicio fue creado manualmente, verificá su configuración. No ejecutes una migración manual repetida: usá el ejecutor del proyecto.
5. En los registros del despliegue comprobá que `0011_admin_security.sql` se aplicó y el servicio está saludable. Sharp necesita sus paquetes nativos: no uses `--omit=optional`; el `npm ci --omit=dev` del proyecto es compatible.
6. Entrá con la contraseña de siempre y verificá que conservás Ajustes, Administradores y confirmación de cobros. Si la migración falla, resolvé ese error antes de habilitar la versión nueva; no borres la base ni cambies tu contraseña para intentar solucionarlo.

## 2. Activar segundo factor en el panel de DM (lo hacés vos)

1. Generá una clave una sola vez en tu equipo con Node:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

2. Guardá los 64 caracteres en tu gestor de contraseñas como **ADMIN_MFA_KEY — DM**. Es una clave privada: no la pegues en GitHub, chats ni capturas.
3. En Render → servicio web → **Environment**, agregá `ADMIN_MFA_KEY` con ese valor. Elegí **Save and deploy**. Esto habilita la posibilidad de configurar MFA, pero no lo activa en ninguna cuenta.
4. Abrí el panel → **Seguridad de mi cuenta** → **Configurar autenticador**. Confirmá tu identidad si se solicita.
5. En tu aplicación de autenticación agregá una cuenta mediante clave manual: nombre DM Comunicación Visual, basada en tiempo/TOTP, seis dígitos, intervalo de 30 segundos. Copiá la clave que muestra el panel. Es una clave distinta de ADMIN_MFA_KEY.
6. Ingresá el código de seis dígitos y pulsá **Verificar y activar**. La configuración provisional vence en diez minutos.
7. Guardá los diez códigos de recuperación en tu gestor de contraseñas antes de cerrar la ventana; no se vuelven a mostrar.
8. Sin cerrar tu sesión original, probá iniciar sesión en otra ventana con contraseña y un código nuevo del autenticador. Un mismo código no puede usarse dos veces; esperá el siguiente si ya lo acabás de usar.
9. No reemplaces ADMIN_MFA_KEY después de activar MFA: las claves del autenticador están cifradas con ella. Guardala junto con el plan de recuperación de la base de datos.

Si perdés el teléfono, ingresá un código de recuperación en el campo de autenticador. Cada código sirve una sola vez. Una vez adentro, podés desactivar y volver a configurar el segundo factor, confirmando tu identidad.

Si perdés todos los códigos, el titular con acceso a la consola privada del servicio Render puede ejecutar:

```sh
node scripts/reset-admin-mfa.js correo-del-administrador@dominio.com
```

Este comando desactiva únicamente el segundo factor del correo indicado, deja contraseña/permisos intactos, cierra sus sesiones y registra la recuperación. No lo ejecutes durante la puesta en marcha normal. Después entrá con la contraseña habitual y configurá un autenticador nuevo. El script `admin:create` restablece contraseña pero no desactiva MFA.

## 3. Activar alertas

1. En Render → Environment, configurá `SECURITY_NOTIFICATION_EMAIL` con tu correo de supervisión. Si falta, se usa `ADMIN_NOTIFICATION_EMAIL`; no se toma del correo editable en el panel.
2. Confirmá `RESEND_API_KEY`, `EMAIL_FROM` y que el remitente está autorizado en Resend. No cambies claves solo por esta actualización.
3. Guardá y desplegá. Después de un cambio legítimo de configuración de pagos, comprobá la llegada del aviso y la sección Registro de correos. No cambies una cuenta bancaria de producción solo para probar: aprovechá un cambio real o hacé la prueba en un entorno de ensayo.
4. Revisá Auditoría: `login_failed`, `login_attack`, `reauth_failed`, `mfa_enabled`, `mfa_disabled` y cambios de usuarios/ajustes. La confirmación de cobros mantiene su propio evento.
5. Las alertas por correo complementan la bitácora; dependen de Resend y no garantizan entrega. No son un sistema de detección de intrusiones completo.

## 4. Proteger las cuentas de infraestructura

1. GitHub: Settings → Password and authentication → activar segundo factor; guardar códigos de recuperación. Revisar colaboradores del repositorio, aplicaciones autorizadas y tokens. Conservá tu propio acceso y retirale permisos solo a personas o integraciones que identifiques como innecesarias.
2. Render: activar 2FA en la configuración personal de la cuenta y conservar recuperación. Si se ingresa con GitHub, proteger también esa cuenta. No impongas un requisito de 2FA a todo el equipo antes de que cada integrante haya configurado el suyo.
3. Supabase: Account → Security → activar MFA de la cuenta del Dashboard. Esto protege Supabase, no reemplaza el segundo factor del panel de DM.
4. Hacé lo mismo con el correo que recibe recuperaciones y con Mercado Pago. Revisá dispositivos y sesiones reconocidos.

## 5. Comprobar base de datos y Supabase sin romper accesos

1. Desde la consola privada de Render, ejecutá después de la migración:

   ```sh
   node scripts/security-check.js
   ```

   Solo lee configuración y metadatos. No cambia permisos ni muestra credenciales o datos de clientes. Los resultados de tablas, roles y MFA pueden compartirse para revisar el siguiente paso.
2. Si la base está en Render, revisá la lista de IP autorizadas para acceso externo. Conservá la conexión interna del servicio web y las IP de mantenimiento que realmente uses; no cierres conexiones a ciegas.
3. Si la base de la aplicación está en Supabase, revisá **Security Advisor**, esquemas expuestos en Data API y permisos de `anon`/`authenticated`. Las tablas de pedidos, administradores, sesiones, correo y ajustes no deben ser accesibles públicamente. No ejecutes un `REVOKE` o RLS genérico sin verificar primero el usuario usado por DATABASE_URL: podría cortar el acceso del servidor. Con el diagnóstico se prepara la política exacta.
4. En Supabase Storage identificá el bucket configurado como `SUPABASE_BUCKET`. Puede ser público para leer fotos del catálogo. La escritura, modificación y borrado no deben estar habilitados libremente para `anon` o usuarios genéricos; el servidor usa su clave privada de servicio.
5. El bucket público debe contener únicamente imágenes de catálogo: no subir documentos, comprobantes ni respaldos.
6. La clave de servicio debe estar solo en las variables de Render. Si hay evidencia de que fue publicada, prepará su rotación y actualizá Render coordinadamente; no borres una clave en uso sin reemplazo.

## 6. Respaldos y recuperación

1. Confirmá en el panel del proveedor la retención efectiva y la última recuperación disponible. Programá exports privados según cuánto trabajo puedas permitirte perder.
2. Probá restaurar un respaldo en **otra base de prueba**, nunca encima de producción. Verificá catálogo, pedidos y acceso del administrador.
3. Respaldá también los archivos del bucket; la copia de PostgreSQL no incluye necesariamente los objetos de Storage.
4. Guardá ADMIN_MFA_KEY y las demás credenciales en un gestor seguro, separado de Git. Una restauración de datos MFA necesita la misma clave de cifrado.
5. Dejá documentado quién puede restaurar y cómo acceder si el equipo habitual no está disponible.

## Referencias oficiales

- [Variables de entorno en Render](https://render.com/docs/configure-environment-variables)
- [Acceso y 2FA en Render](https://render.com/docs/login-settings)
- [Respaldos de PostgreSQL en Render](https://render.com/docs/postgresql-backups)
- [Segundo factor de GitHub](https://docs.github.com/en/authentication/securing-your-account-with-two-factor-authentication-2fa/configuring-two-factor-authentication)
- [Segundo factor del Dashboard de Supabase](https://supabase.com/docs/guides/platform/multi-factor-authentication)
- [RLS y permisos de Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Buenas prácticas de subida de archivos de OWASP](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
