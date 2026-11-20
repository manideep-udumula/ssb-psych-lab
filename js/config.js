/* Supabase connection (project: ssb-psych-board, region ap-south-1 Mumbai).
   The anon key is meant to be public: Row Level Security (supabase/schema.sql)
   makes sure every candidate can only read and write their own rows.
   Set both to "" to run fully offline with browser storage. */
window.SSB_CONFIG = {
  supabaseUrl: "https://lbjyiuenirhxoydfnurw.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxianlpdWVuaXJoeG95ZGZudXJ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ5MjE2MDAsImV4cCI6MjExMDQ5NzYwMH0.R_B47JQpbtj5Fywh89IWckLkX9qDaBh-LPS3kspLmXU",
  // Full-program pass: one UPI payment, checked by hand in HQ → Payments.
  // If you change the UPI ID or price, also regenerate assets/upi-qr.png and update private.settings.pass_price.
  payment: { upiId: "ssbpsychlab@ybl", payee: "SSB Psych Lab", price: 300 },
  // Feedback is saved in Supabase; a database trigger emails it to ssbpsychlab@gmail.com
  // (address set in the private.settings table, not here).
};
