
-- Drop all existing restrictive policies on gifts
DROP POLICY IF EXISTS "Anyone can view gifts" ON public.gifts;
DROP POLICY IF EXISTS "Anyone can reserve a gift" ON public.gifts;
DROP POLICY IF EXISTS "Admins can insert gifts" ON public.gifts;
DROP POLICY IF EXISTS "Admins can update any gift" ON public.gifts;
DROP POLICY IF EXISTS "Admins can delete gifts" ON public.gifts;

-- Recreate as PERMISSIVE policies
CREATE POLICY "Anyone can view gifts" ON public.gifts
FOR SELECT TO anon, authenticated
USING (true);

CREATE POLICY "Anyone can reserve a gift" ON public.gifts
FOR UPDATE TO anon, authenticated
USING (is_available = true)
WITH CHECK (is_available = false AND guest_name IS NOT NULL);

CREATE POLICY "Admins can insert gifts" ON public.gifts
FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update any gift" ON public.gifts
FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete gifts" ON public.gifts
FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));
