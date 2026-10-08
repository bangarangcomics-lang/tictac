# Tictac · cómo publicarla

## Qué hay en esta carpeta

| Archivo | Para qué sirve |
|---|---|
| `index.html`, `app.js`, `styles.css` | La app |
| `config.js` | Aquí pegas los datos de tu Supabase (paso 4) |
| `supabase.sql` | Crea la base de datos y sus reglas de seguridad (paso 5) |
| `manifest.webmanifest`, `sw.js`, `icon-*.png`, `apple-touch-icon.png` | Permiten instalarla en el móvil con el icono del asterisco |
| `fichaje.html`, `contabilidad/` | No se suben a GitHub (están en `.gitignore`) |

## 1 · Crear el proyecto en Supabase

1. supabase.com → **New project**.
2. Name: `tictac` · Database password: *Generate* (guárdala) · Region: **Central EU (Frankfurt)** · Plan: Free.

## 2 · Crear tu usuario de gerente

**Authentication → Users → Add user → Create new user**: tu email y una contraseña, con *Auto Confirm User* marcado.

## 3 · Cerrar los registros

**Authentication → Sign In / Providers** → desactiva **Allow new users to sign up**.
(Además, la app solo da acceso de gerente al primer usuario que entra; aun así, desactívalo.)

## 4 · Copiar las claves a `config.js`

**Project Settings → API Keys** (o **Data API**):
- **Project URL** → pégala en `supabaseUrl`
- Clave **anon** / **publishable** → pégala en `supabaseAnonKey`

Nunca uses la clave `service_role` ni la `secret`.

## 5 · Crear la base de datos

**SQL Editor → New query** → pega todo el contenido de `supabase.sql` → **Run**. Debe terminar con *Success*.

## 6 · Subir a GitHub

1. Crea el repositorio `tictac` (**Public**, sin README).
2. Instala **GitHub Desktop** e inicia sesión.
3. **File → Add local repository** → elige esta carpeta. Si te dice que no es un repositorio, pulsa **create a repository** ahí mismo.
4. **Publish repository** → nombre `tictac`, desmarca *Keep this code private* → Publish.
5. En github.com → tu repositorio → **Settings → Pages** → Source: **Deploy from a branch** → Branch: **main** / **(root)** → Save.
6. En 1–2 minutos: `https://TU-USUARIO.github.io/tictac`

## 7 · Primera puesta en marcha

1. Abre la app → **Acceso gerente** → tu email y contraseña.
2. Rellena empresa, CIF y centro de trabajo.
3. **Empleados → Nuevo empleado**: nombre, PIN de 4 cifras, contrato y días posibles.
4. Prueba a fichar desde tu móvil.

## 8 · Instalar en los móviles

Envía a cada empleado el enlace y, por separado, su PIN.
- **iPhone**: abrir en **Safari** → botón **Compartir** → **Añadir a pantalla de inicio**.
- **Android**: abrir en **Chrome** → menú **⋮** → **Instalar aplicación** (o *Añadir a pantalla de inicio*).

## Cambios futuros

Claude edita los archivos de esta carpeta → en GitHub Desktop: escribe un resumen → **Commit to main** → **Push origin**. En 1–2 minutos todos tienen la nueva versión.

## Copias de seguridad

El plan gratuito de Supabase no hace copias automáticas. Una vez al mes: **Ajustes → Descargar copia completa**, y guarda el archivo en un lugar seguro. El registro de jornada debe conservarse 4 años.

## Seguridad, en resumen

- Los empleados fichan con su PIN; el servidor lo comprueba, y tras 5 fallos bloquea 15 minutos.
- Cada empleado solo ve sus propios fichajes. La hora del fichaje la pone el servidor, no el móvil.
- Solo el gerente (con email y contraseña) ve y edita todo.
