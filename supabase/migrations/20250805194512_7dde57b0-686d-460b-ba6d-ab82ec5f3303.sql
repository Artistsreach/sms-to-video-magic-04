-- Create storage buckets for images and videos
INSERT INTO storage.buckets (id, name, public) VALUES ('images', 'images', true);
INSERT INTO storage.buckets (id, name, public) VALUES ('videos', 'videos', true);

-- Create storage policies for images bucket
CREATE POLICY "Allow public read access to images" 
ON storage.objects 
FOR SELECT 
USING (bucket_id = 'images');

CREATE POLICY "Allow public insert to images" 
ON storage.objects 
FOR INSERT 
WITH CHECK (bucket_id = 'images');

-- Create storage policies for videos bucket  
CREATE POLICY "Allow public read access to videos" 
ON storage.objects 
FOR SELECT 
USING (bucket_id = 'videos');

CREATE POLICY "Allow public insert to videos" 
ON storage.objects 
FOR INSERT 
WITH CHECK (bucket_id = 'videos');