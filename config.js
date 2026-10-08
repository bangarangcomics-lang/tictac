// Configuración de Tictac
// Copia estos dos datos de Supabase → Project Settings → API Keys (o Data API).
// La clave "anon" / "publishable" es pública por diseño: la seguridad está en la base de datos.
// NUNCA pegues aquí la clave "service_role" ni la "secret".

window.TICTAC_CONFIG = {
  supabaseUrl: 'https://prjkdltjtylrubixhvms.supabase.co/rest/v1/',      // ejemplo: https://abcdefghijkl.supabase.co
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByamtkbHRqdHlscnViaXhodm1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0NTQ0NzAsImV4cCI6MjEwNzAzMDQ3MH0.YbS9T6WG3l6xDS0NFE33vWIXoUTYGNzJt7rX0v0-8Us',   // empieza por eyJ... o por sb_publishable_...
};
