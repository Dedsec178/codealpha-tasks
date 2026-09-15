from .views import cart_details


def cart_summary(request):
    _, quantity, total = cart_details(request)
    return {'cart_quantity': quantity, 'cart_total': total}
