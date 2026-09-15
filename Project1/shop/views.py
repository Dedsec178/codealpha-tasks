from decimal import Decimal

from django.contrib import messages
from django.contrib.auth import login
from django.contrib.auth.decorators import login_required
from django.db import transaction
from django.shortcuts import get_object_or_404, redirect, render

from .forms import CheckoutForm, RegisterForm
from .models import Order, OrderItem, Product


def cart_details(request):
    cart = request.session.get('cart', {})
    products = Product.objects.filter(id__in=cart.keys())
    items = []
    total = Decimal('0.00')
    quantity = 0
    for product in products:
        item_quantity = min(int(cart[str(product.id)]), product.stock)
        line_total = product.price * item_quantity
        items.append({'product': product, 'quantity': item_quantity, 'line_total': line_total})
        total += line_total
        quantity += item_quantity
    return items, quantity, total


def home(request):
    products = Product.objects.all()
    query = request.GET.get('q', '').strip()
    category = request.GET.get('category', '').strip()
    if query:
        products = products.filter(name__icontains=query)
    if category:
        products = products.filter(category=category)
    categories = Product.objects.values_list('category', flat=True).distinct()
    return render(request, 'home.html', {'products': products, 'categories': categories, 'query': query, 'active_category': category})


def product_detail(request, slug):
    product = get_object_or_404(Product, slug=slug)
    return render(request, 'product_detail.html', {'product': product})


def add_to_cart(request, product_id):
    product = get_object_or_404(Product, id=product_id)
    cart = request.session.get('cart', {})
    key = str(product.id)
    cart[key] = min(int(cart.get(key, 0)) + 1, product.stock)
    request.session['cart'] = cart
    messages.success(request, f'{product.name} added to your bag.')
    return redirect(request.POST.get('next') or 'home')


def update_cart(request, product_id):
    product = get_object_or_404(Product, id=product_id)
    cart = request.session.get('cart', {})
    value = max(0, min(int(request.POST.get('quantity', 1)), product.stock))
    if value:
        cart[str(product.id)] = value
    else:
        cart.pop(str(product.id), None)
    request.session['cart'] = cart
    return redirect('cart')


def remove_from_cart(request, product_id):
    cart = request.session.get('cart', {})
    cart.pop(str(product_id), None)
    request.session['cart'] = cart
    return redirect('cart')


def cart(request):
    items, quantity, total = cart_details(request)
    return render(request, 'cart.html', {'items': items, 'quantity': quantity, 'total': total})


@login_required
def checkout(request):
    items, _, total = cart_details(request)
    if not items:
        return redirect('cart')
    initial = {'email': request.user.email, 'full_name': request.user.get_full_name()}
    form = CheckoutForm(request.POST or None, initial=initial)
    if request.method == 'POST' and form.is_valid():
        with transaction.atomic():
            order = Order.objects.create(user=request.user, total=total, **form.cleaned_data)
            OrderItem.objects.bulk_create([
                OrderItem(order=order, product=item['product'], quantity=item['quantity'], price=item['product'].price)
                for item in items
            ])
        request.session['cart'] = {}
        return redirect('order_success', order_id=order.id)
    return render(request, 'checkout.html', {'form': form, 'items': items, 'total': total})


def order_success(request, order_id):
    order = get_object_or_404(Order, id=order_id, user=request.user)
    return render(request, 'order_success.html', {'order': order})


def register(request):
    if request.user.is_authenticated:
        return redirect('home')
    form = RegisterForm(request.POST or None)
    if request.method == 'POST' and form.is_valid():
        user = form.save()
        login(request, user)
        return redirect('home')
    return render(request, 'register.html', {'form': form})
