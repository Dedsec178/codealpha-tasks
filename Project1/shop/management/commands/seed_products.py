from django.core.management.base import BaseCommand
from shop.models import Product


class Command(BaseCommand):
    help = 'Add the starter catalog.'

    def handle(self, *args, **options):
        products = [
            ('linen-tote', 'Linen Carryall', 'A roomy everyday tote in washed natural linen.', 'Accessories', '48.00', 'https://images.unsplash.com/photo-1594223274512-ad4803739b7c?w=900', True),
            ('studio-mug', 'Studio Stoneware Mug', 'Hand-finished stoneware with a warm satin glaze.', 'Home', '26.00', 'https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?w=900', True),
            ('daily-notebook', 'Daily Field Notebook', 'A softcover notebook for lists, sketches, and ideas.', 'Stationery', '18.00', 'https://images.unsplash.com/photo-1544816155-12df9643f363?w=900', False),
            ('everyday-cap', 'Everyday Canvas Cap', 'A structured six-panel cap with an easy low profile.', 'Accessories', '32.00', 'https://images.unsplash.com/photo-1521369909029-2afed882baee?w=900', False),
            ('oak-tray', 'Oak Catchall Tray', 'Solid oak tray for keys, candles, and small rituals.', 'Home', '64.00', 'https://images.unsplash.com/photo-1604014237800-1c9102c219da?w=900', True),
            ('field-bottle', 'Field Water Bottle', 'Double-wall stainless steel, built for the long way around.', 'Outdoor', '42.00', 'https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=900', False),
        ]
        for slug, name, description, category, price, image_url, featured in products:
            Product.objects.update_or_create(slug=slug, defaults={'name': name, 'description': description, 'category': category, 'price': price, 'image_url': image_url, 'featured': featured, 'stock': 20})
        self.stdout.write(self.style.SUCCESS('Starter products are ready.'))
