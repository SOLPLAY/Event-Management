from couchbase.auth import PasswordAuthenticator
from couchbase.cluster import Cluster
from couchbase.options import ClusterOptions
from datetime import timedelta
import os
from dotenv import load_dotenv

load_dotenv()

print("Endpoint:", os.getenv("COUCHBASE_CONNECTION_STRING"))
print("Username:", os.getenv("COUCHBASE_USERNAME"))
print("Password exists:", bool(os.getenv("COUCHBASE_PASSWORD")))

auth = PasswordAuthenticator(
    os.getenv("COUCHBASE_USERNAME"),
    os.getenv("COUCHBASE_PASSWORD")
)

options = ClusterOptions(auth)
options.apply_profile("wan_development")

print("Connecting...")

cluster = Cluster.connect(
    os.getenv("COUCHBASE_CONNECTION_STRING"),
    options
)

print("Cluster object created.")

cluster.wait_until_ready(timedelta(seconds=15))

print("CONNECTED SUCCESSFULLY")