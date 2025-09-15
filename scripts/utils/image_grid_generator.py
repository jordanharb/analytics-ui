"""
Image Grid Generator for Token Optimization
Creates 2x2 grids from multiple images to reduce token usage
"""
from PIL import Image, ImageDraw
import io
import requests
from typing import List, Dict, Optional, Tuple
import time

class ImageGridGenerator:
    """Generate image grids for efficient token usage in AI processing"""
    
    def __init__(self, target_size: Tuple[int, int] = (768, 768), grid_size: Tuple[int, int] = (2, 2)):
        """
        Initialize grid generator
        
        Args:
            target_size: Total size of the output grid (width, height)
            grid_size: Grid dimensions (cols, rows)
        """
        self.target_size = target_size
        self.grid_size = grid_size
        self.cell_width = target_size[0] // grid_size[0]
        self.cell_height = target_size[1] // grid_size[1]
        
    def create_grid(self, images_data: List[Dict]) -> Optional[Image.Image]:
        """
        Create a 2x2 grid from up to 4 images
        
        Args:
            images_data: List of dicts with 'pil_image', 'post_uuid' (or 'post_id'), 'platform'
            
        Returns:
            PIL Image of the grid or None if no valid images
        """
        if not images_data:
            return None
            
        # Create white background grid
        grid = Image.new('RGB', self.target_size, 'white')
        draw = ImageDraw.Draw(grid)
        
        # Define positions for 2x2 grid (clockwise from top-left)
        positions = [
            (0, 0),                              # Position 1: Top-left
            (self.cell_width, 0),                # Position 2: Top-right
            (self.cell_width, self.cell_height), # Position 3: Bottom-right
            (0, self.cell_height)                # Position 4: Bottom-left
        ]
        
        # Process each image
        for idx, img_data in enumerate(images_data[:4]):
            if idx >= 4:
                break
                
            try:
                # Get PIL image
                img = img_data.get('pil_image')
                if not img:
                    continue
                    
                # Convert to RGB if needed
                if img.mode != 'RGB':
                    img = img.convert('RGB')
                    
                # Calculate resize to fit entirely within cell while maintaining aspect ratio
                img_ratio = img.width / img.height
                cell_ratio = self.cell_width / self.cell_height
                
                if img_ratio > cell_ratio:
                    # Image is wider - fit to width
                    new_width = self.cell_width - 20  # 10px padding on each side
                    new_height = int(new_width / img_ratio)
                else:
                    # Image is taller - fit to height
                    new_height = self.cell_height - 20  # 10px padding top/bottom
                    new_width = int(new_height * img_ratio)
                
                # Resize image
                img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
                
                # Calculate position to center image in cell
                x_base, y_base = positions[idx]
                x_offset = (self.cell_width - new_width) // 2
                y_offset = (self.cell_height - new_height) // 2
                
                # Draw cell border
                draw.rectangle(
                    [x_base, y_base, x_base + self.cell_width - 1, y_base + self.cell_height - 1],
                    outline='#e0e0e0',
                    width=1
                )
                
                # Paste image centered in cell
                grid.paste(img, (x_base + x_offset, y_base + y_offset))
                
            except Exception as e:
                print(f"  ⚠️ Error processing image {idx}: {e}")
                # Draw placeholder for failed image
                x, y = positions[idx]
                draw.rectangle(
                    [x + 10, y + 10, x + self.cell_width - 10, y + self.cell_height - 10],
                    fill='#f0f0f0',
                    outline='#cccccc',
                    width=2
                )
                draw.text(
                    (x + self.cell_width // 2 - 30, y + self.cell_height // 2 - 10),
                    "Failed",
                    fill='#666666'
                )
                
        # Add grid lines
        draw.line([(self.cell_width, 0), (self.cell_width, self.target_size[1])], fill='#333333', width=2)
        draw.line([(0, self.cell_height), (self.target_size[0], self.cell_height)], fill='#333333', width=2)
        
        return grid
        
    def grid_to_bytes(self, grid: Image.Image) -> Optional[bytes]:
        """
        Convert PIL Image to bytes for API upload
        
        Args:
            grid: PIL Image
            
        Returns:
            JPEG bytes or None if conversion fails
        """
        if not grid:
            return None
            
        try:
            img_byte_arr = io.BytesIO()
            grid.save(img_byte_arr, format='JPEG', quality=85)
            img_byte_arr.seek(0)
            return img_byte_arr.getvalue()
        except Exception as e:
            print(f"  ⚠️ Error converting grid to bytes: {e}")
            return None
            
    def download_image(self, url: str, timeout: int = 10) -> Optional[Image.Image]:
        """
        Download and convert image to PIL format
        
        Args:
            url: Image URL
            timeout: Request timeout in seconds
            
        Returns:
            PIL Image or None if download fails
        """
        try:
            response = requests.get(url, timeout=timeout, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            })
            response.raise_for_status()
            
            # Open as PIL Image
            image = Image.open(io.BytesIO(response.content))
            return image
            
        except Exception as e:
            print(f"  ⚠️ Error downloading image from {url}: {e}")
            return None
            
    def create_grid_from_urls(self, image_infos: List[Dict]) -> Optional[Dict]:
        """
        Create grid from image URLs
        
        Args:
            image_infos: List of dicts with 'url', 'post_uuid' (or 'post_id' for backwards compat), 'platform'
            
        Returns:
            Dict with grid data and metadata or None
        """
        if not image_infos:
            return None
            
        # Download images
        images_data = []
        for info in image_infos[:4]:  # Max 4 images per grid
            pil_image = self.download_image(info['url'])
            if pil_image:
                # Use post_uuid if available, fall back to post_id
                post_identifier = info.get('post_uuid') or info.get('post_id', '')
                images_data.append({
                    'pil_image': pil_image,
                    'post_uuid': post_identifier,
                    'post_id': post_identifier,  # Keep for backwards compatibility
                    'platform': info.get('platform', '')
                })
                time.sleep(0.1)  # Brief delay between downloads
                
        if not images_data:
            return None
            
        # Create grid
        grid = self.create_grid(images_data)
        if not grid:
            return None
            
        # Convert to bytes
        grid_bytes = self.grid_to_bytes(grid)
        if not grid_bytes:
            return None
            
        # Return grid data with metadata
        return {
            'data': grid_bytes,
            'post_uuids': [img['post_uuid'] for img in images_data],
            'post_ids': [img['post_id'] for img in images_data],  # Keep for backwards compatibility
            'platforms': [img['platform'] for img in images_data],
            'image_count': len(images_data)
        }